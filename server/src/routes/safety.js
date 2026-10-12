import { Router } from 'express';
import { db, now } from '../db.js';
import { requireAuth, ok, notify, anyBlocked } from '../util.js';

export const safetyRouter = Router();

// ---------- 安全中心内容 ----------
safetyRouter.get('/tips', (_req, res) => {
  res.json(ok({
    emergency: [
      { icon: 'phone-call', title: '遇到危险立即报警', body: '人身安全受到威胁时，请直接拨打 110。生命安全永远第一位。' },
      { icon: 'share', title: '分享行程给亲友', body: '见搭子前，把搭局时间、地点、对方昵称截图发给信任的朋友或家人。' },
      { icon: 'location', title: '选择公共场所见面', body: '首次见面建议选商场、连锁餐厅等人多明亮的地方，避免偏僻场所或单独乘车。' },
      { icon: 'slash', title: '拒绝任何站外转账', body: '“代订酒店”“内部票价”“保证金解冻”都是诈骗话术，平台内不收取任何费用。' },
      { icon: 'eye', title: '饮品离开视线不饮用', body: '见面时保持警惕，饮品食物离开视线后不再食用，不轻易透露住址。' },
      { icon: 'shield', title: '信任搭力值与评价', body: '优先选择已完成实名/学生认证、搭力值高、有搭后好评的用户组局。' },
    ],
    community_rules: [
      '搭搭是一个轻社交平台，只找搭子，不搞婚恋相亲。',
      '禁止发布涉黄、涉赌、涉毒及其他违法违规内容，“费用全包”“仅限女生”等暗语将被下架并封号。',
      '禁止引流到站外（微信号、二维码、外链），所有沟通请在站内完成。',
      '禁止欺诈、刷单、代订、借钱等行为，发现立即举报。',
      '见面爽约、骚扰辱骂他人将被扣减搭力值，累计 3 次违规封号。',
      '请对搭子保持友善与边界感，搭后欢迎留下真实评价。',
    ],
  }));
});

// ---------- 一键应急上报（女性安全保护） ----------
safetyRouter.post('/sos', requireAuth, (req, res) => {
  const { post_id, location, note } = req.body || {};
  // 记录为高优先级举报，管理员立即可见
  db.prepare('INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, 'user', parseInt((req.body || {}).target_user_id) || 0, '人身安全',
      `【紧急求助】${String(location || '未提供位置')} | ${String(note || '').slice(0, 300)} | 关联搭局:${post_id || '无'}`, 'pending', now());
  // 通知全体管理员
  const admins = db.prepare('SELECT id FROM users WHERE is_admin = 1').all();
  for (const a of admins) {
    notify(a.id, 'sos', '紧急求助', `用户 ${req.user.nickname} 发起紧急求助，请立即处理`, { reporter_id: req.user.id });
  }
  res.json(ok({ reported: true, message: '已收到你的求助，平台已通知风控人员。如遇紧急情况请务必先拨打 110。' }));
});

// ---------- 我的拉黑/紧急状态 ----------
safetyRouter.get('/my-emergency-contacts', requireAuth, (req, res) => {
  // 演示环境返回引导文案（真实环境接入通讯录/短信SDK）
  res.json(ok({ hint: '请在手机上将 110 与信任亲友设为紧急联系人；见搭子前建议开启位置共享给亲友。' }));
});
