// v3.0 VD-02 定时任务：搭局自动过期 / 搭后互评提醒 / 老搭子新局定向推送
// 纯进程内 setInterval（unref，不阻止退出），零外部服务依赖（C4）；
// 三个子任务各自 try-catch，单轮失败只记日志、绝不 crash 主进程。
import { db, now } from './db.js';
import { notify } from './util.js';

const INTERVAL_MS = 10 * 60 * 1000;           // 每 10 分钟一轮
const EXPIRE_DAYS = 14;                        // open 帖发布超 14 天未成行 → expired
const RATE_REMIND_HOURS = 72;                  // done 超 72h 仍未互评 → 提醒（互评是信用飞轮入口）
const PARTNER_PUSH_WINDOW_MS = 24 * 3600_000;  // 老搭子推送只扫近 24h 新帖（events 防重天然幂等）
const PARTNER_PUSH_DAILY_CAP = 2;              // 每接收者每日 ≤2 条，防打扰（规格 VD-02-3）

// ① 搭局自动过期：僵尸 open 帖让供给新鲜度失真 → 置 expired 并通知组局者
function jobExpirePosts() {
  const rows = db.prepare("SELECT * FROM posts WHERE status = 'open' AND created_at < ?")
    .all(now() - EXPIRE_DAYS * 86400000);
  for (const p of rows) {
    db.prepare("UPDATE posts SET status = 'expired' WHERE id = ? AND status = 'open'").run(p.id);
    notify(p.user_id, 'post_expired', '搭局已过期',
      `「${p.title}」发布超过 ${EXPIRE_DAYS} 天仍未成行，已自动关闭。可重新发布，或若已完成请标记为已完成。`, { post_id: p.id });
  }
  return rows.length;
}

// ② 搭后互评提醒：done 超 72h 仍有参与者未互评 → notify 一次
// done 时间依据：posts 无 done 字段 → 用标记完成时写入的 events(type='done') 时间（BE-1 埋点）。
// 防重：events 里已存在 type='rate_reminder' 且同 post_id 的标记行 → 跳过（每帖只提醒一轮）。
function jobRateReminders() {
  const deadline = now() - RATE_REMIND_HOURS * 3600_000;
  const doneEvents = db.prepare("SELECT post_id FROM events WHERE type = 'done' AND created_at < ?").all(deadline);
  const remindedPostIds = [];
  for (const { post_id } of doneEvents) {
    const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(post_id);
    if (!p || p.status !== 'done') continue;
    if (db.prepare("SELECT 1 FROM events WHERE type = 'rate_reminder' AND post_id = ?").get(p.id)) continue;
    const participants = [
      p.user_id,
      ...db.prepare("SELECT user_id FROM joins WHERE post_id = ? AND status = 'approved'").all(p.id).map((r) => r.user_id),
    ];
    let sent = 0;
    for (const uid of participants) {
      const others = participants.filter((x) => x !== uid);
      const hasUnrated = others.some((o) => !db.prepare(
        'SELECT 1 FROM ratings WHERE post_id = ? AND rater_id = ? AND ratee_id = ?'
      ).get(p.id, uid, o));
      if (!hasUnrated) continue;
      notify(uid, 'rate_reminder', '别忘了互评',
        `「${p.title}」已完成，给搭子留下评价，好搭子才能被更多人看见`, { post_id: p.id });
      sent++;
    }
    if (sent) {
      // 防重标记（系统事件：user_id NULL + post_id）
      db.prepare('INSERT INTO events (user_id, type, post_id, created_at) VALUES (NULL,?,?,?)')
        .run('rate_reminder', p.id, now());
      remindedPostIds.push(p.id);
    }
  }
  return remindedPostIds;
}

// ③ 老搭子新局推送：作者的新 open 帖 → 其搭友（partners 表）同城者收到
// "你的老搭子X发布了新局"。防重：events(type='partner_push', user_id, post_id) 唯一标记。
function jobPartnerPush() {
  const since = now() - PARTNER_PUSH_WINDOW_MS;
  const rows = db.prepare("SELECT * FROM posts WHERE status = 'open' AND created_at >= ? ORDER BY created_at DESC, id DESC")
    .all(since);
  const dupStmt = db.prepare("SELECT 1 FROM events WHERE type = 'partner_push' AND user_id = ? AND post_id = ?");
  const markStmt = db.prepare('INSERT INTO events (user_id, type, post_id, created_at) VALUES (?,?,?,?)');
  const capStmt = db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'partner_push' AND user_id = ? AND created_at > ?");
  let sent = 0;
  for (const p of rows) {
    const partners = db.prepare(`
      SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END partner_id
      FROM partners WHERE user_a = ? OR user_b = ?
    `).all(p.user_id, p.user_id, p.user_id);
    if (!partners.length) continue;
    const author = db.prepare('SELECT * FROM users WHERE id = ?').get(p.user_id);
    for (const pt of partners) {
      const buddy = db.prepare('SELECT * FROM users WHERE id = ?').get(pt.partner_id);
      if (!buddy || buddy.status !== 'active') continue;
      if (buddy.city !== p.city) continue;                      // 同城才推
      if (dupStmt.get(buddy.id, p.id)) continue;                // 此帖已推过
      if (capStmt.get(buddy.id, now() - 86400000).c >= PARTNER_PUSH_DAILY_CAP) continue; // 每日上限
      // notify 的 operatorId 参数天然处理拉黑关系（双向任一拉黑不投递）
      notify(buddy.id, 'partner_new_post', '老搭子发了新局',
        `你的老搭子${author.nickname}发布了新局「${p.title}」，去看看吧`, { post_id: p.id }, author.id);
      markStmt.run(buddy.id, 'partner_push', p.id, now());
      sent++;
    }
  }
  return sent;
}

// 单轮执行（导出供测试与手动触发）；返回各任务结果摘要
export function runJobs() {
  let expired = 0;
  let reminded = [];
  let pushed = 0;
  try { expired = jobExpirePosts(); } catch (e) { console.error('[dada] jobs 过期任务失败:', e.message); }
  try { reminded = jobRateReminders(); } catch (e) { console.error('[dada] jobs 互评提醒任务失败:', e.message); }
  try { pushed = jobPartnerPush(); } catch (e) { console.error('[dada] jobs 老搭子推送任务失败:', e.message); }
  return { expired, reminded, pushed };
}

let timer = null;
export function startJobs() {
  if (timer) return;
  timer = setInterval(() => {
    try { runJobs(); } catch { /* 双保险：绝不向进程冒泡 */ }
  }, INTERVAL_MS);
  timer.unref(); // 不阻止进程退出
  console.log('[dada] 定时任务已启动（每 10 分钟：搭局过期 / 互评提醒 / 老搭子推送）');
}
