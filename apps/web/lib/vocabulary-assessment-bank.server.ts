import 'server-only';

export interface AssessmentBankItem {
  id: string;
  band: number;
  targetWord: string;
  sentence: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
}

function item(
  band: number,
  targetWord: string,
  sentence: string,
  options: [string, string, string, string],
  correctIndex: 0 | 1 | 2 | 3,
): AssessmentBankItem {
  return {
    id: `ava-b${String(band).padStart(2, '0')}-${targetWord}`,
    band,
    targetWord,
    sentence,
    options,
    correctIndex,
  };
}

// Aurelis 原创 Beta 题库。正式上线前仍需按文档要求完成人工复核与真实作答校准。
export const vocabularyAssessmentBank: readonly AssessmentBankItem[] = [
  item(1, 'accept', 'Mina decided to accept the invitation after checking her schedule.', ['拒绝', '接受', '修改', '寄送'], 1),
  item(1, 'borrow', 'Could I borrow your umbrella until the rain stops?', ['借入', '购买', '修理', '隐藏'], 0),
  item(1, 'calm', 'The nurse remained calm while everyone else looked worried.', ['疲惫的', '安静镇定的', '粗心的', '匆忙的'], 1),
  item(1, 'discover', 'Scientists hope to discover more about the lake this summer.', ['忘记', '争论', '发现', '保护'], 2),

  item(2, 'ancient', 'The museum displays tools made by ancient communities.', ['古老的', '现代的', '昂贵的', '危险的'], 0),
  item(2, 'border', 'Several small towns lie close to the northern border.', ['港口', '边界', '山谷', '首都'], 1),
  item(2, 'contain', 'Each box can contain up to twelve glass bottles.', ['打碎', '包含', '交换', '清洗'], 1),
  item(2, 'ordinary', 'It looked like an ordinary notebook from the outside.', ['普通的', '私人的', '巨大的', '空的'], 0),

  item(3, 'accurate', 'The first map was surprisingly accurate for its time.', ['完整的', '准确的', '彩色的', '公开的'], 1),
  item(3, 'benefit', 'One benefit of the new schedule is a longer lunch break.', ['缺点', '目的', '好处', '规则'], 2),
  item(3, 'decline', 'Ticket sales began to decline after the holiday period.', ['增加', '减少', '稳定', '公布'], 1),
  item(3, 'maintain', 'Regular inspections help maintain the bridge in good condition.', ['维持', '拆除', '测量', '穿过'], 0),

  item(4, 'adjacent', 'Students may use the laboratory in the adjacent building.', ['废弃的', '相邻的', '临时的', '地下的'], 1),
  item(4, 'compensate', 'The company offered to compensate travelers for the delay.', ['提醒', '补偿', '责备', '安排'], 1),
  item(4, 'emerge', 'New details began to emerge during the second interview.', ['消失', '重复', '出现', '冲突'], 2),
  item(4, 'reluctant', 'At first, the committee was reluctant to change the policy.', ['不情愿的', '没资格的', '迫切的', '有信心的'], 0),

  item(5, 'coherent', 'Her final report presented a coherent account of the events.', ['夸张的', '连贯的', '机密的', '简短的'], 1),
  item(5, 'inhibit', 'Cold temperatures can inhibit the growth of these plants.', ['预测', '抑制', '加速', '记录'], 1),
  item(5, 'obscure', 'The reference comes from an obscure journal published decades ago.', ['鲜为人知的', '官方的', '流行的', '有争议的'], 0),
  item(5, 'prevalent', 'This farming method is prevalent throughout the coastal region.', ['受到禁止的', '昂贵的', '普遍存在的', '刚发明的'], 2),

  item(6, 'arbitrary', 'Researchers warned that the original cutoff point was arbitrary.', ['任意武断的', '保守的', '精确的', '合理的'], 0),
  item(6, 'deteriorate', 'Without repairs, the paintings will continue to deteriorate.', ['增值', '恶化', '复制', '展出'], 1),
  item(6, 'feasible', 'A smaller survey may be feasible within the available budget.', ['可行的', '非法的', '不可避免的', '无关的'], 0),
  item(6, 'profound', 'The printing press had a profound effect on the spread of knowledge.', ['短暂的', '深远的', '负面的', '可预测的'], 1),

  item(7, 'ambiguous', 'The wording of the agreement was deliberately ambiguous.', ['模棱两可的', '冒犯性的', '正式的', '重复的'], 0),
  item(7, 'cumulative', 'The study examined the cumulative impact of several small changes.', ['相互矛盾的', '累积的', '直接的', '无法测量的'], 1),
  item(7, 'indispensable', 'Accurate field notes are indispensable to the research team.', ['难以获得的', '必不可少的', '过时的', '容易替代的'], 1),
  item(7, 'scrutinize', 'Independent reviewers will scrutinize the evidence before publication.', ['概括', '仔细审查', '删除', '重新排序'], 1),

  item(8, 'corroborate', 'Two later surveys corroborate the pattern reported in the first study.', ['反驳', '证实', '简化', '遗漏'], 1),
  item(8, 'mitigate', 'Planting trees can help mitigate extreme heat in dense neighborhoods.', ['加剧', '衡量', '缓解', '预测'], 2),
  item(8, 'pervasive', 'Mobile technology now has a pervasive influence on daily routines.', ['无处不在的', '偶然的', '短期的', '有益的'], 0),
  item(8, 'stringent', 'The laboratory follows stringent rules for handling the material.', ['灵活的', '严格的', '不成文的', '临时的'], 1),

  item(9, 'anomalous', 'The team repeated the test after noticing one anomalous result.', ['异常的', '预期的', '最终的', '相同的'], 0),
  item(9, 'delineate', 'The introduction should clearly delineate the scope of the investigation.', ['扩大', '清楚界定', '质疑', '隐藏'], 1),
  item(9, 'equivocal', 'The early evidence was equivocal and supported neither explanation.', ['确凿的', '含糊不定的', '伪造的', '无关的'], 1),
  item(9, 'salient', 'The summary highlights the most salient differences between the models.', ['细微的', '突出的', '虚构的', '技术性的'], 1),

  item(10, 'circumscribe', 'Strict eligibility rules circumscribe who may enter the program.', ['鼓励', '限制', '识别', '保护'], 1),
  item(10, 'cogent', 'The panel found her explanation clear and cogent.', ['有说服力的', '情绪化的', '冗长的', '不合时宜的'], 0),
  item(10, 'disparate', 'The archive brings together documents from disparate sources.', ['可靠的', '迥然不同的', '匿名的', '互相依赖的'], 1),
  item(10, 'engender', 'A lack of transparency may engender distrust among residents.', ['消除', '引发', '掩盖', '衡量'], 1),

  item(11, 'ameliorate', 'The revised policy was intended to ameliorate overcrowding.', ['记录', '改善', '证明', '容忍'], 1),
  item(11, 'concomitant', 'Rapid expansion brought a concomitant increase in maintenance costs.', ['随之发生的', '意料之外的', '微不足道的', '周期性的'], 0),
  item(11, 'obfuscate', 'Technical language can obfuscate an otherwise simple argument.', ['支持', '使模糊', '压缩', '引用'], 1),
  item(11, 'recalcitrant', 'A few recalcitrant members continued to resist the agreed changes.', ['经验丰富的', '顽固反抗的', '犹豫不决的', '缺席的'], 1),

  item(12, 'abstruse', 'Even specialists found parts of the theoretical chapter abstruse.', ['深奥难懂的', '缺乏证据的', '引人入胜的', '高度实用的'], 0),
  item(12, 'contumacious', 'The contumacious official repeatedly ignored the court order.', ['恭顺的', '公正的', '桀骜抗命的', '新上任的'], 2),
  item(12, 'nugatory', 'Without reliable records, the proposed comparison would be nugatory.', ['开创性的', '毫无价值的', '十分昂贵的', '容易完成的'], 1),
  item(12, 'pellucid', 'Her pellucid explanation made the difficult concept accessible.', ['清晰易懂的', '刻意含糊的', '带有讽刺的', '未经准备的'], 0),

  item(13, 'apodictic', 'The author makes an apodictic claim despite the limited evidence.', ['无可争辩式的', '试探性的', '自相矛盾的', '道歉性的'], 0),
  item(13, 'inchoate', 'At that stage, the proposal remained inchoate and lacked a clear structure.', ['秘密的', '尚未成形的', '过于激进的', '广受欢迎的'], 1),
  item(13, 'jejune', 'Critics dismissed the essay as jejune and lacking serious analysis.', ['枯燥肤浅的', '优雅成熟的', '证据充分的', '措辞谨慎的'], 0),
  item(13, 'perfidious', 'The history describes a perfidious ally who broke every promise.', ['忠诚的', '背信弃义的', '势力强大的', '不受欢迎的'], 1),

  item(14, 'anfractuous', 'The hikers followed an anfractuous trail through the rocky hills.', ['平坦笔直的', '狭窄拥挤的', '蜿蜒曲折的', '标记清楚的'], 2),
  item(14, 'hebetude', 'After the sleepless journey, he struggled with a sense of hebetude.', ['兴奋', '迟钝倦怠', '愤怒', '孤独'], 1),
  item(14, 'rebarbative', 'The book’s rebarbative style discouraged many otherwise patient readers.', ['难亲近且令人反感的', '幽默轻松的', '简洁优美的', '熟悉亲切的'], 0),
  item(14, 'sybaritic', 'The memoir portrays a sybaritic court devoted to luxury and pleasure.', ['崇尚奢靡享乐的', '纪律严明的', '与世隔绝的', '学术气息浓厚的'], 0),
];

export const vocabularyBankById = new Map(
  vocabularyAssessmentBank.map((bankItem) => [bankItem.id, bankItem]),
);
