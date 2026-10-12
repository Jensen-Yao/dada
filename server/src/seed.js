import bcrypt from 'bcryptjs';
import { db, now } from './db.js';
import { CATEGORIES } from './util.js';

console.log('搭搭种子数据生成中...');

const t = now();
const hash = bcrypt.hashSync('123456', 10);

const users = [
  ['admin', '搭搭小助手', 'female', 1996, '北京', '朝阳区', '', '平台运营', 'ENFJ', '搭搭官方账号，维护社区安全与秩序～', '["官方", "靠谱"]', 1, 1, 1, 10],
  ['xiaoyu', '小鱼干', 'female', 2000, '北京', '海淀区', '北京大学', '学生', 'INFP', '想找饭搭子和电影搭子，周末喜欢citywalk 🐟', '["美食", "电影", "citywalk"]', 1, 1, 0, 5],
  ['runner', '阿跑', 'male', 1998, '北京', '朝阳区', '', '互联网从业者', 'ESTP', '马拉松爱好者，早起跑步的搭子有吗', '["跑步", "健身", "马拉松"]', 0, 1, 0, 2],
  ['momo', 'momo', 'female', 2001, '北京', '海淀区', '清华大学', '学生', 'ENFP', 'e人但社恐，想找学习搭子互相监督', '["自习", "图书馆", "咖啡"]', 1, 0, 0, 4],
  ['laoxu', '老徐', 'male', 1990, '北京', '西城区', '', '摄影师', 'ISTP', '扫街拍照，周末约拍互免', '["摄影", "扫街", "胶片"]', 0, 1, 0, 7],
  ['kiki', 'KiKi', 'female', 1999, '上海', '静安区', '', '设计师', 'INFJ', 'livehouse常驻，找演出搭子', '["livehouse", "摇滚", "探店"]', 0, 1, 0, 9],
  ['daye', '王大爷', 'male', 1975, '北京', '海淀区', '', '退休', 'ISFJ', '遛狗钓鱼下象棋，年轻人带我一个', '["遛狗", "钓鱼", "象棋"]', 0, 0, 0, 8],
  ['sherry', 'Sherry', 'female', 1997, '深圳', '南山区', '', '产品经理', 'ENTJ', '爬山、飞盘、露营，周末不宅', '["爬山", "飞盘", "露营"]', 0, 1, 0, 3],
  ['xiaoke', '小柯', 'male', 2002, '北京', '昌平区', '北京航空航天大学', '学生', 'INTP', '游戏开黑（瓦/撸/农），剧本杀拼车', '["游戏", "剧本杀", "桌游"]', 1, 0, 0, 6],
  ['meimei', '美美', 'female', 1995, '成都', '锦江区', '', '自由职业', 'ESFP', '火锅探店选手，成都美食地图活地图', '["火锅", "探店", "美甲"]', 0, 0, 0, 1],
];

const uidByUsername = {};
for (const [username, nickname, gender, birth, city, district, school, occupation, mbti, bio, tags, vs, vr, admin, avatar] of users) {
  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exist) { uidByUsername[username] = exist.id; continue; }
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, avatar, gender, birth_year, city, district, school, occupation, mbti, bio, tags, verify_student, verify_real, is_admin, credit, created_at, last_active_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(username, hash, nickname, `/img/avatars/photo-${avatar}.jpg`, gender, birth, city, district, school, occupation, mbti, bio, tags, vs, vr, admin, 600 + Math.floor(Math.random() * 200), t - Math.floor(Math.random() * 90 * 86400000), t - Math.floor(Math.random() * 3 * 86400000));
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
  ['runner', 'commute', '国贸到望京通勤拼车，工作日早高峰', '每天8点国贸出发到望京，走京密路，拼商务车，每人25/天，长期拼', '北京', '国贸 — 望京', '工作日 08:00', 3, 'aa', 'any', '时间稳定的上班族'],
];

// ---------- v2.3 PC-02b：新增 12 条新帖（瀑布流内容量翻倍，14 分类全覆盖） ----------
// 地点/时间/性别要求/图片映射按规格 §F.2 表固化；文案为真实小红书风格（具体地点+时间+可执行要求）
const newPosts = [
  ['sherry', 'travel', '梧桐山夜爬看日出，凌晨三点半好汉坡集合', '本周六凌晨三点半好汉坡登山口集合，摸黑上山约两个半小时，山顶看日出+云海。要求：穿登山鞋、带头灯或手电，带件外套山顶风大。下山一起吃个早茶，AA制，放鸽子拉黑处理', '深圳', '梧桐山好汉坡', '本周六 03:30', 3, 'aa', 'any', '体力中等以上，头灯必带，准时到集合点'],
  ['xiaoyu', 'travel', '五一西湖群山徒步组队，宝石山看日落收工', '五一假期不想人挤人，规划了一条西湖群山小环线：老和山—北高峰—美人峰—宝石山收尾看日落，全程约12公里。速度不快边走边拍，自带水和干粮，收工一起吃西湖醋鱼', '杭州', '宝石山', '5月1日 15:00', 4, 'free', 'any', '能走完10公里以上，拍照搭子优先，不催速度'],
  ['xiaoke', 'game', '瓦罗兰特开黑五排，白金以上速来', '周五晚八点网鱼网咖五道口店包间开黑五排冲分，目前3人（铂金2/铂金3/翡翠1），缺两个能沟通不摆烂的。要求白金段位以上、有麦、会报点，演员和嘴臭选手绕道', '北京', '五道口 网鱼网咖', '周五 20:00', 2, 'free', 'male', '白金以上段位，全程开麦，不摆烂不骂人'],
  ['kiki', 'game', '双人成行缺个 P2，通关了我请奶茶', '周日下午网鱼网咖静安店，双人成行打了一半卡在玩具店那关，缺个稳定的P2一起通关。手柄店里有不用自备，通关了我请奶茶。没玩过也行，温柔教学，别抢手柄就行', '上海', '网鱼网咖静安店', '周日 14:00', 1, 'treat', 'any', '有耐心不抢操作，周日能准时到'],
  ['meimei', 'shopping', '太古里逛街淘小店，会砍价的优先', '周六下午一点半太古里地铁口集合，目标是淘两件春秋外套，顺便逛逛新开的买手店和小众饰品店。我会砍价但脸皮薄，希望找个能一起张嘴的搭子，逛完一起去吃冷淡杯', '成都', '成都太古里', '本周六 13:30', 2, 'free', 'female', '女生，会砍价或愿意学，体力好能逛一下午'],
  ['kiki', 'movie', '大光明电影院二刷《沙丘3》，散场聊剧情', '周五晚七点半大光明电影院IMAX厅二刷《沙丘3》，第一遍看得意犹未尽。票已买好原价转一张不加价，散场去旁边咖啡店聊半小时剧情再回家。要求看过前两部，别给没看过的路人剧透', '上海', '大光明电影院', '本周五 19:30', 1, 'aa', 'any', '看过《沙丘》前作，观影不玩手机'],
  ['sherry', 'coffee', '华侨城创意园咖啡巡礼，一天三家走断腿', '本周日华侨城创意园咖啡citywalk，计划打卡三家：老牌手冲店—新晋dirty专门店—社区烘焙咖啡馆，每家点一杯招牌分着喝（一人三杯怕失眠）。人均预算80左右，喜欢拍照的带相机', '深圳', '华侨城创意园', '本周日 10:30', 2, 'aa', 'female', '女生，喜欢咖啡，能走一天不喊累'],
  ['kiki', 'sports', '世纪公园羽毛球 2 小时，缺 2 人 AA 场费', '周日上午九点半世纪公园羽毛球馆，已订好场地，目前4人缺2，打2小时场费人均30左右。水平：能打多拍回合但不专业，主打出汗+开心。球我带，球拍自备或提前说好借你', '上海', '世纪公园', '本周日 09:30', 2, 'aa', 'any', '会基本高远球和发球，准时到场不鸽'],
  ['meimei', 'boardgame', '玉林路剧本杀《年轮》还缺 1，哭点低勿入', '本周六下午两点玉林路某某剧本杀，6人情感本《年轮》还缺1位，DM是店长本人带本很稳。我已玩过同系列，节奏不拖。泪点低的慎入，上次全车哭到纸巾不够，玩完一起吃玉林串串', '成都', '玉林路 某某剧本杀', '本周六 14:00', 1, 'aa', 'any', '能全程投入不掉线，情感本老手新手均可'],
  ['xiaoke', 'other', '国博看展搭子，周日上午人少不挤', '周日上午九点国家博物馆北门集合，看古代中国基本陈列，周末上午人少光线好。我做了攻略可以当半个导游，你负责帮忙拍照。逛完中午一起吃碗面散伙，门票免费但记得提前在公众号预约', '北京', '国家博物馆', '本周日 09:00', 2, 'free', 'any', '提前预约国博门票，对历史展览有点兴趣'],
  ['xiaoke', 'commute', '昌平线早高峰拼车，沙河—西二旗', '工作日早7点40沙河站B口集合，拼车直达西二旗软件园，全程25分钟避开昌平线限流，人均8元一天，目前3人缺1-2位。要求时间稳定不迟到（迟到不等车费照摊），长期拼可拉周卡小群', '北京', '沙河站 — 西二旗', '工作日 07:40', 3, 'aa', 'any', '工作日稳定通勤，7:40前能到集合点'],
  ['momo', 'study', '清华图书馆期末周占座搭子，互相监督打卡', '期末周苟命计划：工作日早8点半清华图书馆门口集合占座，一起学到11点半吃饭，下午自由安排。规则：手机锁包里，每小时休息10分钟，谁摸鱼谁请奶茶。校外进不了馆的同学别硬约', '北京', '清华图书馆', '工作日 08:30', 1, 'free', 'female', '女生，能进清华图书馆，能坚持一周以上'],
];

const pidByIndex = [];
// v2.3 PC-02a：真实照片 images 映射（/img/photos/*.jpg，按帖子 title 语义分配，规格 §F.2 表）
// 日料帖保持 3 图；无映射的帖子维持奇偶交替旧 SVG 单图兜底（C5 兼容）
const DEMO_IMAGES = {
  '周六中午五道口吃日料放题，缺一个饭搭子': ['food-2', 'food-3', 'coffee-1'],
  '奥森晨跑10km，配速6分以内': ['sports-1', 'sports-2'],
  '国图自习搭子，考研互相监督': ['study-1', 'study-2'],
  '周末鼓楼扫街，胶片数码都可以': ['photo-1', 'photo-2'],
  '下周五MAO livehouse独立乐队拼场': ['live-1', 'live-2'],
  '每天早上元土城遛狗，找遛狗搭子': ['pet-1', 'pet-3'],
  '周日塘朗山徒步，山顶看日落': ['travel-2', 'travel-3'],
  '剧本杀拼车，周六下午情感本': ['boardgame-1', 'boardgame-2'],
  '成都火锅搭子，微辣起步，鸳鸯锅勿扰': ['food-3', 'food-2'],
  '周五晚《沙丘3》IMAX，找观影搭子': ['movie-1', 'movie-2'],
  '周末咖啡探店，鼓楼附近三家': ['coffee-1', 'coffee-2', 'coffee-3'],
  '国贸到望京通勤拼车，工作日早高峰': ['commute-1', 'commute-2'],
  // 新增 12 帖
  '梧桐山夜爬看日出，凌晨三点半好汉坡集合': ['travel-1', 'travel-3'],
  '五一西湖群山徒步组队，宝石山看日落收工': ['travel-2', 'travel-1'],
  '瓦罗兰特开黑五排，白金以上速来': ['game-1', 'game-3'],
  '双人成行缺个 P2，通关了我请奶茶': ['game-2', 'game-1'],
  '太古里逛街淘小店，会砍价的优先': ['shopping-1', 'shopping-2'],
  '大光明电影院二刷《沙丘3》，散场聊剧情': ['movie-2', 'movie-1'],
  '华侨城创意园咖啡巡礼，一天三家走断腿': ['coffee-2', 'coffee-3'],
  '世纪公园羽毛球 2 小时，缺 2 人 AA 场费': ['sports-2', 'sports-3'],
  '玉林路剧本杀《年轮》还缺 1，哭点低勿入': ['boardgame-2', 'boardgame-1'],
  '国博看展搭子，周日上午人少不挤': ['other-1', 'other-2'],
  '昌平线早高峰拼车，沙河—西二旗': ['commute-2', 'commute-1'],
  '清华图书馆期末周占座搭子，互相监督打卡': ['study-1', 'study-2'],
};
const allPosts = [...posts, ...newPosts];
for (const [i, [username, category, title, content, city, loc, meet, need, fee, greq, req]] of allPosts.entries()) {
  const exist = db.prepare('SELECT id FROM posts WHERE title = ?').get(title);
  if (exist) { pidByIndex.push(exist.id); continue; }
  const mapped = DEMO_IMAGES[title];
  const images = mapped ? mapped.map((n) => `/img/photos/${n}.jpg`)
    : [`/img/covers/${category}${i % 2 ? '-2' : ''}.svg`];
  const info = db.prepare(`
    INSERT INTO posts (user_id, category, title, content, city, location_name, meet_time, need_count, fee_mode, gender_req, requirements, images, status, likes_count, views_count, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)
  `).run(uidByUsername[username], category, title, content, city, loc, meet, need, fee, greq, req,
    JSON.stringify(images),
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

// ---------- 演示会话：xiaoyu 与 meimei 围绕日料帖的邀约对话 ----------
{
  const xiaoyuId = uidByUsername.xiaoyu;
  const meimeiId = uidByUsername.meimei;
  const [ua, ub] = xiaoyuId < meimeiId ? [xiaoyuId, meimeiId] : [meimeiId, xiaoyuId];
  let conv = db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(ua, ub);
  if (!conv) {
    const info = db.prepare('INSERT INTO conversations (post_id, user_a, user_b, last_msg_at, created_at) VALUES (?,?,?,?,?)')
      .run(pidByIndex[0], ua, ub, t, t);
    conv = { id: Number(info.lastInsertRowid) };
  }
  const hasMsg = db.prepare('SELECT 1 FROM messages WHERE conv_id = ? LIMIT 1').get(conv.id);
  if (!hasMsg) {
    // 时间基准：从种子时间往前推 7 分钟，随后按对话顺序每条递增 1 分钟
    let ts = t - 7 * 60000;
    const dialog = [
      [meimeiId, '你好呀！刷到你的日料放题帖，还缺饭搭子吗？我三文鱼能吃一打 🍣'],
      [xiaoyuId, '缺缺缺！就等一个能吃的搭子，一个人吃放题实在太尴尬了'],
      [meimeiId, '那可太好了，我饭量你放心，绝不冷场，微辣也完全 OK'],
      [xiaoyuId, '周六 11:25 店门口碰头怎么样？吃完还能去旁边的书店逛逛'],
      [meimeiId, '没问题，周六我准时到！到时候你穿什么，我认一下人'],
      [xiaoyuId, '我背绿色双肩包，头像就是本人～期待周六一起干饭！'],
    ];
    dialog.forEach(([senderId, text], idx) => {
      ts += 60000;
      db.prepare('INSERT INTO messages (conv_id, sender_id, type, content, created_at) VALUES (?,?,?,?,?)')
        .run(conv.id, senderId, 'text', text, ts);
      // 模拟 handleChatMessage 行为：首条消息后插入一条安全提示
      if (idx === 0) {
        db.prepare('INSERT INTO messages (conv_id, sender_id, type, content, created_at) VALUES (?,?,?,?,?)')
          .run(conv.id, senderId, 'safety', '安全提示：请勿脱离平台交易或转账，谨防诈骗。首次见面建议选择人多的公共场所。', ts);
      }
    });
    db.prepare('UPDATE conversations SET last_msg_at = ? WHERE id = ?').run(ts, conv.id);
    console.log('   演示会话已写入：xiaoyu 与 meimei（日料帖，6 条消息 + 1 条安全提示）');
  }
}

console.log(`完成：${Object.keys(uidByUsername).length} 个用户，${pidByIndex.length} 条搭局`);
console.log('   演示账号：xiaoyu / 123456（普通用户，已认证）');
console.log('   管理账号：admin / 123456（运营后台）');
