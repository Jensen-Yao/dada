import bcrypt from 'bcryptjs';
import { db, now } from './db.js';
import { CATEGORIES } from './util.js';

console.log('🌱 搭搭种子数据生成中...');

const t = now();
const hash = bcrypt.hashSync('123456', 10);

const users = [
  ['admin', '搭搭小助手', 'female', 1996, '北京', '朝阳区', '', '平台运营', 'ENFJ', '搭搭官方账号，维护社区安全与秩序～', '["官方", "靠谱"]', 1, 1, 1, 'u10'],
  ['xiaoyu', '小鱼干', 'female', 2000, '北京', '海淀区', '北京大学', '学生', 'INFP', '想找饭搭子和电影搭子，周末喜欢citywalk 🐟', '["美食", "电影", "citywalk"]', 1, 1, 0, 'u5'],
  ['runner', '阿跑', 'male', 1998, '北京', '朝阳区', '', '互联网从业者', 'ESTP', '马拉松爱好者，早起跑步的搭子有吗', '["跑步", "健身", "马拉松"]', 0, 1, 0, 'u2'],
  ['momo', 'momo', 'female', 2001, '北京', '海淀区', '清华大学', '学生', 'ENFP', 'e人但社恐，想找学习搭子互相监督', '["自习", "图书馆", "咖啡"]', 1, 0, 0, 'u4'],
  ['laoxu', '老徐', 'male', 1990, '北京', '西城区', '', '摄影师', 'ISTP', '扫街拍照，周末约拍互免', '["摄影", "扫街", "胶片"]', 0, 1, 0, 'u7'],
  ['kiki', 'KiKi', 'female', 1999, '上海', '静安区', '', '设计师', 'INFJ', 'livehouse常驻，找演出搭子', '["livehouse", "摇滚", "探店"]', 0, 1, 0, 'u9'],
  ['daye', '王大爷', 'male', 1975, '北京', '海淀区', '', '退休', 'ISFJ', '遛狗钓鱼下象棋，年轻人带我一个', '["遛狗", "钓鱼", "象棋"]', 0, 0, 0, 'u8'],
  ['sherry', 'Sherry', 'female', 1997, '深圳', '南山区', '', '产品经理', 'ENTJ', '爬山、飞盘、露营，周末不宅', '["爬山", "飞盘", "露营"]', 0, 1, 0, 'u3'],
  ['xiaoke', '小柯', 'male', 2002, '北京', '昌平区', '北京航空航天大学', '学生', 'INTP', '游戏开黑（瓦/撸/农），剧本杀拼车', '["游戏", "剧本杀", "桌游"]', 1, 0, 0, 'u6'],
  ['meimei', '美美', 'female', 1995, '成都', '锦江区', '', '自由职业', 'ESFP', '火锅探店选手，成都美食地图活地图', '["火锅", "探店", "美甲"]', 0, 0, 0, 'u1'],
];

const uidByUsername = {};
for (const [username, nickname, gender, birth, city, district, school, occupation, mbti, bio, tags, vs, vr, admin, avatar] of users) {
  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exist) { uidByUsername[username] = exist.id; continue; }
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, avatar, gender, birth_year, city, district, school, occupation, mbti, bio, tags, verify_student, verify_real, is_admin, credit, created_at, last_active_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(username, hash, nickname, `/img/avatars/${avatar}.svg`, gender, birth, city, district, school, occupation, mbti, bio, tags, vs, vr, admin, 600 + Math.floor(Math.random() * 200), t - Math.floor(Math.random() * 90 * 86400000), t - Math.floor(Math.random() * 3 * 86400000));
  uidByUsername[username] = Number(info.lastInsertRowid);
}

const posts = [
  ['xiaoyu', 'food', '周六中午五道口吃日料放题，缺一个饭搭子', '想吃鲸也吞不下了的那家三文鱼放题，一个人吃有点尴尬，找个饭搭子边吃边聊～吃完可以去旁边的书店逛逛', '北京', '五道口', '本周六 11:30', 1, 'aa', 'any', '能吃辣的优先，聊天不冷场就行'],
  ['runner', 'sports', '奥森晨跑10km，配速6分以内', '每周六早上奥森南园集合，跑10公里，配速530-600之间，跑完一起吃早饭。长期固定，欢迎加入', '北京', '奥林匹克森林公园', '每周六 07:00', 3, 'free', 'any', '能坚持跑完10km，不分快慢'],
  ['momo', 'study', '国图自习搭子，考研互相监督', '每天上午去国图自习，找同样考研的搭子互相监督打卡，中午一起吃饭，学累了可以聊天放松', '北京', '国家图书馆', '工作日 09:00-17:00', 1, 'free', 'any', '希望也是考研党，能坚持到考试'],
  ['laoxu', 'photo', '周末鼓楼扫街，胶片数码都可以', '老街巷子正在消失，趁还在多拍拍。路线：鼓楼-烟袋斜街-后海。可以互拍人像，纯交流不收费', '北京', '鼓楼', '本周日 14:00', 2, 'free', 'any', '有相机就行，手机摄影也欢迎'],
  ['kiki', 'live', '下周五MAO livehouse独立乐队拼场', '小众独立乐队，票价120，已买两张，原价出一张，看完可以一起喝一杯聊聊', '上海', 'MAO Livehouse', '下周五 20:00', 1, 'aa', 'any', '喜欢独立摇滚，不聊八卦'],
  ['daye', 'pet', '每天早上元土城遛狗，找遛狗搭子', '我家金毛叫馒头，很温顺。每天早上7点半遛一小时，附近养狗的朋友可以一起，狗也有伴', '北京', '元大都城垣遗址公园', '每天 07:30', 2, 'free', 'any', '文明养犬，牵绳'],
  ['sherry', 'sports', '周日塘朗山徒步，山顶看日落', '强度不大，来回4小时，山顶看日落超美。带足水和小零食，下山一起吃农家菜', '深圳', '塘朗山', '本周日 15:00', 3, 'aa', 'any', '体力正常即可，不催速度'],
  ['xiaoke', 'boardgame', '剧本杀拼车，周六下午情感本', '本已选好《某某》，6人情感本还缺2，DM靠谱，老手新手都行，玩完一起吃晚饭', '北京', '五道口 某某剧本杀', '本周六 14:00', 2, 'aa', 'any', '不跳车不放鸽子，沉浸式体验'],
  ['meimei', 'food', '成都火锅搭子，微辣起步，鸳鸯锅勿扰', '玉林那家苍蝇馆子火锅，周五晚上，缺2个能吃辣的搭子，吃完可以搓麻将', '成都', '玉林路', '本周五 19:00', 2, 'aa', 'female', '能吃辣，饭量正常，不劝酒'],
  ['xiaoyu', 'movie', '周五晚《沙丘3》IMAX，找观影搭子', '英皇电影城IMAX厅，杜比音效超棒，看完可以聊聊剧情，不剧透不玩手机', '北京', '英皇电影城', '本周五 19:30', 1, 'aa', 'any', '观影不玩手机，看完愿意聊剧情'],
  ['momo', 'coffee', '周末咖啡探店，鼓楼附近三家', '探三家网红咖啡店，每家点一杯招牌拍照打卡，AA，全程大概3小时', '北京', '鼓楼', '本周六 10:30', 2, 'aa', 'female', '喜欢咖啡或拍照，有相机更好'],
  ['runner', 'commute', '国贸到望京通勤拼车，工作日早高峰', '每天8点国贸出发到望京，走京密路，拼商务车，每人25/天，长期拼', '北京', '国贸 → 望京', '工作日 08:00', 3, 'aa', 'any', '时间稳定的上班族'],
];

const pidByIndex = [];
for (const [username, category, title, content, city, loc, meet, need, fee, greq, req] of posts) {
  const exist = db.prepare('SELECT id FROM posts WHERE title = ?').get(title);
  if (exist) { pidByIndex.push(exist.id); continue; }
  const info = db.prepare(`
    INSERT INTO posts (user_id, category, title, content, city, location_name, meet_time, need_count, fee_mode, gender_req, requirements, images, status, likes_count, views_count, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)
  `).run(uidByUsername[username], category, title, content, city, loc, meet, need, fee, greq, req,
    JSON.stringify([`/img/covers/${category}.svg`]),
    Math.floor(Math.random() * 20), 50 + Math.floor(Math.random() * 500), t - Math.floor(Math.random() * 7 * 86400000));
  pidByIndex.push(Number(info.lastInsertRowid));
}

// 一些点赞、评论让广场看起来活跃
const sampleComments = [
  ['runner', 0, '已赞！可惜周六有事，下周带上我'],
  ['momo', 1, '配速6分半可以吗，想加入'],
  ['xiaoke', 3, '手机摄影能上车吗'],
  ['daye', 5, '馒头和萨摩耶能玩到一块去'],
  ['sherry', 6, '塘朗山日落绝了，已申请'],
  ['laoxu', 9, '《沙丘》系列都好看，蹲一个后续'],
];
for (const [username, idx, text] of sampleComments) {
  const pid = pidByIndex[idx];
  if (!pid || db.prepare('SELECT 1 FROM comments WHERE post_id = ? AND user_id = ? AND content = ?').get(pid, uidByUsername[username], text)) continue;
  db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?,?,?,?)').run(pid, uidByUsername[username], text, t - Math.floor(Math.random() * 3 * 86400000));
  db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(pid);
}

console.log(`✅ 完成：${Object.keys(uidByUsername).length} 个用户，${pidByIndex.length} 条搭局`);
console.log('   演示账号：xiaoyu / 123456（普通用户，已认证）');
console.log('   管理账号：admin / 123456（运营后台）');
