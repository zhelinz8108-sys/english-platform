import type {
  GrammarExample,
  GrammarLesson,
  GrammarLevelId,
  GrammarMistake,
  GrammarPublicQuestion,
  GrammarQuestionKind,
  GrammarQuestionOption,
  GrammarRuleBlock,
  GrammarSourceRef,
  GrammarStage,
} from './grammar.js';

interface PracticeExample extends GrammarExample {
  practice?: {
    prompt: string;
    answers: string[];
    explanation: string;
  };
}

interface PracticeMistake extends GrammarMistake {
  distractors: [string, string];
}

interface TrueFalseCheck {
  kind: 'true_false';
  prompt: string;
  answer: boolean;
  explanation: string;
}

interface ChoiceCheck {
  kind: 'single_choice';
  prompt: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
}

type StageCheck = TrueFalseCheck | ChoiceCheck;

interface StageBlueprint {
  level: GrammarLevelId;
  label: string;
  focus: string;
  estimatedMinutes: number;
  objectives: string[];
  rules: GrammarRuleBlock[];
  examples: PracticeExample[];
  mistakes: PracticeMistake[];
  sources: GrammarSourceRef[];
  checks: [StageCheck, StageCheck, StageCheck];
}

interface LessonBlueprint {
  topicId: string;
  title: string;
  english: string;
  overview: string;
  stages: [StageBlueprint, StageBlueprint, StageBlueprint];
}

export interface GrammarQuestionDefinition {
  id: string;
  topicId: string;
  level: GrammarLevelId;
  kind: GrammarQuestionKind;
  prompt: string;
  instruction: string;
  options?: GrammarQuestionOption[];
  correctAnswer: string;
  acceptedAnswers?: string[];
  explanation: string;
}

const source = (
  bookId: GrammarLevelId,
  levelLabel: string,
  rangeLabel: string,
): GrammarSourceRef => ({ bookId, levelLabel, rangeLabel });

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('en')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.。!?！？]+$/u, '');
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function choiceOptions(
  labels: readonly string[],
  correctIndex: number,
  seed: string,
): { options: GrammarQuestionOption[]; correctAnswer: string } {
  const offset = hash(seed) % labels.length;
  const ordered = labels.map((_, index) => (index + offset) % labels.length);
  const options = ordered.map((originalIndex, index) => ({
    id: `choice-${index + 1}`,
    label: labels[originalIndex]!,
  }));
  const deliveredCorrectIndex = ordered.indexOf(correctIndex);
  return { options, correctAnswer: `choice-${deliveredCorrectIndex + 1}` };
}

function toStage(topicId: string, blueprint: StageBlueprint): GrammarStage {
  const practiceExamples = blueprint.examples.filter((example) => example.practice);
  if (
    blueprint.rules.length < 3 ||
    blueprint.examples.length !== 6 ||
    practiceExamples.length !== 4 ||
    blueprint.mistakes.length !== 3
  ) {
    throw new Error(`Invalid grammar stage blueprint: ${topicId}:${blueprint.level}`);
  }
  return {
    id: `${topicId}:${blueprint.level}`,
    level: blueprint.level,
    label: blueprint.label,
    focus: blueprint.focus,
    estimatedMinutes: blueprint.estimatedMinutes,
    objectives: blueprint.objectives,
    rules: blueprint.rules,
    examples: blueprint.examples.map(({ practice: _practice, ...example }) => example),
    mistakes: blueprint.mistakes.map(({ distractors: _distractors, ...mistake }) => mistake),
    sources: blueprint.sources,
    questionCount: 10,
    practiceAvailable: true,
  };
}

function buildQuestions(topicId: string, blueprint: StageBlueprint): GrammarQuestionDefinition[] {
  const prefix = `${topicId}:${blueprint.level}`;
  const checks = blueprint.checks.map((check, index): GrammarQuestionDefinition => {
    const id = `${prefix}:q${index + 1}`;
    if (check.kind === 'true_false') {
      return {
        id,
        topicId,
        level: blueprint.level,
        kind: check.kind,
        prompt: check.prompt,
        instruction: '判断这句话是否正确。',
        options: [
          { id: 'true', label: '正确' },
          { id: 'false', label: '错误' },
        ],
        correctAnswer: check.answer ? 'true' : 'false',
        explanation: check.explanation,
      };
    }
    const delivered = choiceOptions(check.options, check.correctIndex, id);
    return {
      id,
      topicId,
      level: blueprint.level,
      kind: check.kind,
      prompt: check.prompt,
      instruction: '选择最合适的答案。',
      ...delivered,
      explanation: check.explanation,
    };
  });
  const cloze = blueprint.examples
    .filter(
      (
        example,
      ): example is PracticeExample & { practice: NonNullable<PracticeExample['practice']> } =>
        Boolean(example.practice),
    )
    .map((example, index): GrammarQuestionDefinition => {
      const id = `${prefix}:q${index + 4}`;
      return {
        id,
        topicId,
        level: blueprint.level,
        kind: 'fill_blank',
        prompt: example.practice.prompt,
        instruction: '填写空缺部分，不区分大小写。',
        correctAnswer: example.practice.answers[0]!,
        acceptedAnswers: example.practice.answers,
        explanation: example.practice.explanation,
      };
    });
  const corrections = blueprint.mistakes.map((mistake, index): GrammarQuestionDefinition => {
    const id = `${prefix}:q${index + 8}`;
    const delivered = choiceOptions([mistake.right, mistake.wrong, ...mistake.distractors], 0, id);
    return {
      id,
      topicId,
      level: blueprint.level,
      kind: 'error_correction',
      prompt: `选择正确的句子：${mistake.wrong}`,
      instruction: '选择语法正确且意思自然的改写。',
      ...delivered,
      explanation: mistake.explanation,
    };
  });
  return [...checks, ...cloze, ...corrections];
}

const lessons: LessonBlueprint[] = [
  {
    topicId: 'present-contrast',
    title: '一般现在时与现在进行时比较',
    english: 'Present Simple and Present Continuous',
    overview: '用时间范围和说话者视角区分稳定事实、重复习惯、当前过程与暂时安排。',
    stages: [
      {
        level: 'beginner',
        label: '初级',
        focus: '先判断“平时”还是“此刻”',
        estimatedMinutes: 8,
        objectives: [
          '识别习惯与当前动作',
          '正确构成第三人称单数和 be + -ing',
          '避免给常见状态动词随意加 -ing',
        ],
        rules: [
          {
            title: '习惯和事实',
            body: '一般现在时描述经常发生的行为、长期状态或普遍事实。',
            pattern: 'subject + base verb / verb-s',
          },
          {
            title: '正在发生',
            body: '现在进行时描述说话此刻正在进行，或当前阶段暂时发生的事情。',
            pattern: 'subject + am/is/are + verb-ing',
          },
          {
            title: '先看时间线索',
            body: 'usually、every day 常提示一般现在时；now、at the moment 常提示现在进行时。',
          },
        ],
        examples: [
          {
            english: 'Mia walks to school every day.',
            chinese: '米娅每天步行上学。',
            practice: {
              prompt: 'Mia ___ to school every day. (walk)',
              answers: ['walks'],
              explanation: 'every day 表示习惯；主语 Mia 是第三人称单数，所以用 walks。',
            },
          },
          {
            english: 'Mia is taking the bus today.',
            chinese: '米娅今天正在坐公交车。',
            practice: {
              prompt: 'Mia ___ the bus today. (take)',
              answers: ['is taking'],
              explanation: 'today 表示与平时不同的临时安排，使用 is taking。',
            },
          },
          {
            english: 'Water boils at 100°C.',
            chinese: '水在100摄氏度沸腾。',
            practice: {
              prompt: 'Water ___ at 100°C. (boil)',
              answers: ['boils'],
              explanation: '普遍事实使用一般现在时。',
            },
          },
          {
            english: 'Please be quiet. The baby is sleeping.',
            chinese: '请安静，宝宝正在睡觉。',
            practice: {
              prompt: 'Please be quiet. The baby ___. (sleep)',
              answers: ['is sleeping'],
              explanation: '动作正在说话时发生，使用现在进行时。',
            },
          },
          { english: 'I usually drink tea after lunch.', chinese: '我通常午饭后喝茶。' },
          {
            english: 'We are studying in the library this week.',
            chinese: '这周我们在图书馆学习。',
            note: 'this week 表示暂时阶段。',
          },
        ],
        mistakes: [
          {
            wrong: 'She go to work at eight.',
            right: 'She goes to work at eight.',
            explanation: '一般现在时中，第三人称单数肯定句的动词通常加 -s。',
            distractors: ['She is go to work at eight.', 'She going to work at eight.'],
          },
          {
            wrong: 'Look! It rains.',
            right: 'Look! It is raining.',
            explanation: 'Look! 指向眼前正在发生的动作，应使用现在进行时。',
            distractors: ['Look! It raining.', 'Look! It does raining.'],
          },
          {
            wrong: 'I am knowing the answer.',
            right: 'I know the answer.',
            explanation: 'know 通常表示状态，不用于表示当前状态的进行时。',
            distractors: ['I knowing the answer.', 'I do knowing the answer.'],
          },
        ],
        sources: [source('beginner', '初级', 'Unit 7-8')],
        checks: [
          {
            kind: 'true_false',
            prompt: '“Leo plays tennis on Saturdays.” 描述的是重复习惯。',
            answer: true,
            explanation: 'on Saturdays 表示规律重复的时间。',
          },
          {
            kind: 'single_choice',
            prompt: '选择表示“此刻正在写邮件”的句子。',
            options: [
              'Nora writes an email now.',
              'Nora is writing an email now.',
              'Nora write an email now.',
              'Nora writing an email now.',
            ],
            correctIndex: 1,
            explanation: 'now 对应当前过程，结构是 is writing。',
          },
          {
            kind: 'true_false',
            prompt: '一般现在时的第三人称单数肯定句可以始终使用动词原形。',
            answer: false,
            explanation: '通常需要使用 -s/-es 形式。',
          },
        ],
      },
      {
        level: 'intermediate',
        label: '中级',
        focus: '区分长期、暂时与变化中的情形',
        estimatedMinutes: 10,
        objectives: [
          '比较永久状态和暂时行为',
          '理解 always + 进行时的态度色彩',
          '识别状态动词的动态含义',
        ],
        rules: [
          {
            title: '长期与暂时',
            body: '同一动作可因说话者选择的时间范围不同而使用一般时或进行时。',
            pattern: 'permanent/routine vs temporary/current',
          },
          {
            title: '变化中的趋势',
            body: '表示逐渐变化的情形时常用进行时，如 is getting、are increasing。',
          },
          {
            title: '带态度的重复',
            body: 'always、constantly 与进行时连用时，常表达抱怨、惊讶或赞赏。',
          },
          {
            title: '状态动词的动态用法',
            body: 'think、have、see 等动词在表示活动而非状态时可以使用进行时。',
          },
        ],
        examples: [
          {
            english: 'I work in Shanghai, but I am working from Hangzhou this month.',
            chinese: '我在上海工作，但这个月暂时在杭州办公。',
            practice: {
              prompt: 'I normally work in Shanghai, but I ___ from Hangzhou this month. (work)',
              answers: ['am working'],
              explanation: 'this month 限定了暂时阶段，使用现在进行时。',
            },
          },
          {
            english: 'More people are choosing electric cars.',
            chinese: '越来越多人正在选择电动汽车。',
            practice: {
              prompt: 'More people ___ electric cars as prices fall. (choose)',
              answers: ['are choosing'],
              explanation: '描述当前正在发展的趋势，使用 are choosing。',
            },
          },
          {
            english: 'I think the plan is sensible.',
            chinese: '我认为这个计划合理。',
            practice: {
              prompt: 'I ___ the plan is sensible. (think)',
              answers: ['think'],
              explanation: 'think 表示观点时通常使用一般现在时。',
            },
          },
          {
            english: 'I am thinking about changing jobs.',
            chinese: '我正在考虑换工作。',
            practice: {
              prompt: 'I ___ about changing jobs. (think)',
              answers: ['am thinking'],
              explanation: 'think about 表示正在进行的思考活动，可以使用进行时。',
            },
          },
          {
            english: 'Kai is always leaving his mug on my desk.',
            chinese: '凯老是把杯子留在我桌上。',
            note: '进行时表达说话者的不满。',
          },
          { english: 'The river flows through three provinces.', chinese: '这条河流经三个省。' },
        ],
        mistakes: [
          {
            wrong: 'This soup is tasting too salty.',
            right: 'This soup tastes too salty.',
            explanation: 'taste 在这里表示食物具有的味道，是状态用法。',
            distractors: ['This soup taste too salty.', 'This soup does tasting too salty.'],
          },
          {
            wrong: 'I stay with my aunt this week.',
            right: 'I am staying with my aunt this week.',
            explanation: 'this week 表示临时居住安排，进行时更自然。',
            distractors: ['I staying with my aunt this week.', 'I am stay with my aunt this week.'],
          },
          {
            wrong: 'Prices get higher at the moment.',
            right: 'Prices are getting higher at the moment.',
            explanation: 'at the moment 描述正在发展的变化，应使用进行时。',
            distractors: [
              'Prices is getting higher at the moment.',
              'Prices getting higher at the moment.',
            ],
          },
        ],
        sources: [source('intermediate', '中级', 'Unit 4')],
        checks: [
          {
            kind: 'single_choice',
            prompt: '哪句话最自然地表达“她暂时和朋友住在一起”？',
            options: [
              'She lives with friends this week.',
              'She is living with friends this week.',
              'She live with friends this week.',
              'She does living with friends this week.',
            ],
            correctIndex: 1,
            explanation: 'this week 表示暂时阶段，使用 is living。',
          },
          {
            kind: 'true_false',
            prompt: '“He is always helping new colleagues.” 可以带有赞赏的感情色彩。',
            answer: true,
            explanation: 'always + 进行时既可抱怨，也可依据语境表达赞赏。',
          },
          {
            kind: 'true_false',
            prompt: 'think 无论表示“认为”还是“考虑”，都绝不能使用进行时。',
            answer: false,
            explanation: '表示思考活动的 be thinking about 可以使用进行时。',
          },
        ],
      },
      {
        level: 'advanced',
        label: '高级',
        focus: '用体貌选择表达立场、语体和信息焦点',
        estimatedMinutes: 12,
        objectives: [
          '分析说话者如何框定时间范围',
          '掌握施为动词和即时评论中的一般现在时',
          '处理状态动词的有标记进行时',
        ],
        rules: [
          {
            title: '视角而非客观时长',
            body: '一般时把情形作为整体或常态呈现；进行时把它放进一个有限、展开中的时间窗口。',
          },
          {
            title: '施为与即时评论',
            body: '正式陈述中的 promise、recommend、apologise，以及体育评论、演示说明常使用一般现在时。',
          },
          {
            title: '有标记的状态进行时',
            body: '状态动词使用进行时可强调暂时性、变化或刻意表现，如 You are being unfair。',
          },
          { title: '叙事中的现在时', body: '口头叙事可用一般现在时推进事件，用进行时建立背景。' },
        ],
        examples: [
          {
            english: 'I recommend that the committee postpone the vote.',
            chinese: '我建议委员会推迟表决。',
            practice: {
              prompt: 'I ___ that the committee postpone the vote. (recommend)',
              answers: ['recommend'],
              explanation: '正式施为陈述通常用一般现在时。',
            },
          },
          {
            english: 'You are being unusually patient today.',
            chinese: '你今天表现得格外耐心。',
            practice: {
              prompt: 'You ___ unusually patient today. (be)',
              answers: ['are being'],
              explanation: 'be 的进行时强调今天暂时表现出的行为。',
            },
          },
          {
            english: 'The striker passes, turns, and shoots.',
            chinese: '前锋传球、转身并射门。',
            practice: {
              prompt: 'The striker ___, turns, and shoots. (pass)',
              answers: ['passes'],
              explanation: '即时体育评论常用一般现在时。',
            },
          },
          {
            english: 'I am loving the quieter pace of life here.',
            chinese: '我越来越喜欢这里更慢的生活节奏。',
            practice: {
              prompt: 'I ___ the quieter pace of life here more each day. (love)',
              answers: ['am loving'],
              explanation: '有标记的进行时强调正在发展的体验，语体较口语化。',
            },
          },
          {
            english: 'So I open the door, and everyone is staring at me.',
            chinese: '于是我打开门，所有人都正盯着我。',
          },
          {
            english: 'The evidence suggests that demand is weakening.',
            chinese: '证据表明需求正在走弱。',
          },
        ],
        mistakes: [
          {
            wrong: 'I am hereby promising to report the findings honestly.',
            right: 'I hereby promise to report the findings honestly.',
            explanation: '带 hereby 的正式施为句通常用一般现在时完成言语行为。',
            distractors: [
              'I hereby am promise to report the findings honestly.',
              'I hereby promising to report the findings honestly.',
            ],
          },
          {
            wrong: 'She is seeming more confident these days.',
            right: 'She seems more confident these days.',
            explanation: 'seem 通常保持状态用法；表示变化可改用 is becoming。',
            distractors: [
              'She seem more confident these days.',
              'She does seeming more confident these days.',
            ],
          },
          {
            wrong: 'You are selfish whenever you refuse this request.',
            right: 'You are being selfish by refusing this request.',
            explanation: '批评当前行为时，are being selfish 比把人格永久化的 are selfish 更准确。',
            distractors: [
              'You being selfish by refusing this request.',
              'You have being selfish by refusing this request.',
            ],
          },
        ],
        sources: [source('advanced', '高级', 'Unit 1-2')],
        checks: [
          {
            kind: 'true_false',
            prompt: '进行时可以把本来稳定的性质重新解释为暂时行为。',
            answer: true,
            explanation: '例如 You are being rude 聚焦当前表现，而非永久性格。',
          },
          {
            kind: 'single_choice',
            prompt: '哪句话最符合正式会议中的即时建议？',
            options: [
              'I am recommending we adjourn.',
              'I recommend that we adjourn.',
              'I recommending that we adjourn.',
              'I do recommending we adjourn.',
            ],
            correctIndex: 1,
            explanation: '施为动词 recommend 用一般现在时直接完成建议行为。',
          },
          {
            kind: 'true_false',
            prompt: '一般现在时只能表示每天重复的习惯。',
            answer: false,
            explanation: '它还可表示状态、事实、施为、评论和叙事推进等。',
          },
        ],
      },
    ],
  },
  {
    topicId: 'countability',
    title: '可数名词与不可数名词',
    english: 'Countable and Uncountable Nouns',
    overview: '根据名词表达的是独立个体、材料、活动还是抽象概念，选择冠词、复数和数量词。',
    stages: [
      {
        level: 'beginner',
        label: '初级',
        focus: '会数的个体与不可直接计数的整体',
        estimatedMinutes: 8,
        objectives: ['识别常见可数与不可数名词', '正确使用 a/an 和复数', '使用 some、much、many'],
        rules: [
          {
            title: '可数名词',
            body: '可数名词有单数和复数；单数通常需要 a/an 或其他限定词。',
            pattern: 'a chair / two chairs',
          },
          {
            title: '不可数名词',
            body: '不可数名词通常没有复数形式，也不能直接与 a/an 连用。',
            pattern: 'some water / much information',
          },
          {
            title: '用单位来计数',
            body: '不可数名词可借助 piece、bottle、cup 等单位表达数量。',
            pattern: 'a piece of advice',
          },
        ],
        examples: [
          {
            english: 'There is an apple on the table.',
            chinese: '桌上有一个苹果。',
            practice: {
              prompt: 'There is ___ apple on the table.',
              answers: ['an'],
              explanation: 'apple 是以元音音素开头的可数名词单数，使用 an。',
            },
          },
          {
            english: 'We need some information.',
            chinese: '我们需要一些信息。',
            practice: {
              prompt: 'We need some ___. (information)',
              answers: ['information'],
              explanation: 'information 是不可数名词，不加复数 -s。',
            },
          },
          {
            english: 'She gave me two pieces of advice.',
            chinese: '她给了我两条建议。',
            practice: {
              prompt: 'She gave me two ___ of advice.',
              answers: ['pieces'],
              explanation: 'advice 不可直接计数，用 pieces of advice。',
            },
          },
          {
            english: 'How many chairs are in the room?',
            chinese: '房间里有多少把椅子？',
            practice: {
              prompt: 'How ___ chairs are in the room?',
              answers: ['many'],
              explanation: 'chairs 是可数名词复数，使用 many。',
            },
          },
          { english: 'There is not much milk left.', chinese: '剩下的牛奶不多了。' },
          { english: 'I bought a loaf of bread.', chinese: '我买了一条面包。' },
        ],
        mistakes: [
          {
            wrong: 'I need an advice.',
            right: 'I need some advice.',
            explanation: 'advice 是不可数名词，不能直接与 an 连用。',
            distractors: ['I need advices.', 'I need a advices.'],
          },
          {
            wrong: 'She bought three furnitures.',
            right: 'She bought three pieces of furniture.',
            explanation: 'furniture 是不可数名词，计数时使用 pieces of。',
            distractors: ['She bought three furniture.', 'She bought a three furniture.'],
          },
          {
            wrong: 'How much books do you have?',
            right: 'How many books do you have?',
            explanation: 'books 是可数名词复数，使用 how many。',
            distractors: ['How many book do you have?', 'How much book do you have?'],
          },
        ],
        sources: [source('beginner', '初级', 'Unit 65-66')],
        checks: [
          {
            kind: 'true_false',
            prompt: 'information 通常作为不可数名词使用。',
            answer: true,
            explanation: '不能说 an information 或 informations。',
          },
          {
            kind: 'single_choice',
            prompt: '选择正确的数量表达。',
            options: ['two advices', 'two advice', 'two pieces of advice', 'an advice'],
            correctIndex: 2,
            explanation: 'advice 通过 pieces of 计数。',
          },
          {
            kind: 'true_false',
            prompt: '所有可数名词单数都可以不带限定词单独使用。',
            answer: false,
            explanation: '普通可数名词单数通常需要冠词、指示词或所有格等限定。',
          },
        ],
      },
      {
        level: 'intermediate',
        label: '中级',
        focus: '同一名词在不同含义下改变可数性',
        estimatedMinutes: 10,
        objectives: [
          '区分材料义与个体义',
          '掌握 experience、paper、room 等双重用法',
          '选择 fewer、less 和数量结构',
        ],
        rules: [
          {
            title: '意义决定可数性',
            body: '名词的可数性属于具体含义，而不是永远固定的词典标签。',
            pattern: 'chicken 肉 / a chicken 一只鸡',
          },
          {
            title: '抽象与具体实例',
            body: 'experience 表示经验时不可数，表示一次经历时可数；work 与 a work 也有类似意义差异。',
          },
          {
            title: '数量比较',
            body: 'fewer 修饰可数复数，less 修饰不可数名词；正式语体中应保持这一差别。',
          },
          {
            title: '集合量词',
            body: 'a great deal of、an amount of 常接不可数名词；a large number of 接可数复数。',
          },
        ],
        examples: [
          {
            english: 'We do not have enough room for another desk.',
            chinese: '我们没有足够空间再放一张桌子。',
            practice: {
              prompt: 'We do not have enough ___ for another desk. (room)',
              answers: ['room'],
              explanation: 'room 表示“空间”时不可数。',
            },
          },
          {
            english: 'The hotel has thirty rooms.',
            chinese: '这家酒店有三十个房间。',
            practice: {
              prompt: 'The hotel has thirty ___. (room)',
              answers: ['rooms'],
              explanation: 'room 表示独立房间时是可数名词。',
            },
          },
          {
            english: 'Teaching requires experience.',
            chinese: '教学需要经验。',
            practice: {
              prompt: 'Teaching requires ___. (experience)',
              answers: ['experience'],
              explanation: '表示积累的经验时不可数。',
            },
          },
          {
            english: 'The hike was an unforgettable experience.',
            chinese: '那次徒步是一次难忘的经历。',
            practice: {
              prompt: 'The hike was an unforgettable ___. (experience)',
              answers: ['experience'],
              explanation: '表示一次具体经历时可数，可与 an 连用。',
            },
          },
          {
            english: 'We produced less waste this month.',
            chinese: '我们这个月产生的废弃物更少。',
          },
          {
            english: 'Fewer applicants completed the final task.',
            chinese: '完成最终任务的申请者更少。',
          },
        ],
        mistakes: [
          {
            wrong: 'There were less errors in the revision.',
            right: 'There were fewer errors in the revision.',
            explanation: 'errors 是可数复数，正式表达使用 fewer。',
            distractors: [
              'There was fewer error in the revision.',
              'There were little errors in the revision.',
            ],
          },
          {
            wrong: 'The lab bought new equipments.',
            right: 'The lab bought new equipment.',
            explanation: 'equipment 是不可数名词；需要计数时可说 pieces of equipment。',
            distractors: ['The lab bought an equipment.', 'The lab bought new equipmentes.'],
          },
          {
            wrong: 'I have many work to finish.',
            right: 'I have a lot of work to finish.',
            explanation: 'work 表示工作量时不可数，不能用 many。',
            distractors: ['I have many works to finish.', 'I have a work to finishings.'],
          },
        ],
        sources: [source('intermediate', '中级', 'Unit 69-71')],
        checks: [
          {
            kind: 'single_choice',
            prompt: '哪句话把 experience 用作一次具体经历？',
            options: [
              'She has experience in design.',
              'Experience matters.',
              'It was a strange experience.',
              'He lacks experience.',
            ],
            correctIndex: 2,
            explanation: 'a strange experience 指一次具体经历。',
          },
          {
            kind: 'true_false',
            prompt: 'paper 表示材料时通常不可数，表示报纸或论文时可以可数。',
            answer: true,
            explanation: '同一拼写可因意义不同改变可数性。',
          },
          {
            kind: 'true_false',
            prompt: '正式英语中，less 通常用于修饰可数名词复数。',
            answer: false,
            explanation: '可数复数通常使用 fewer。',
          },
        ],
      },
      {
        level: 'advanced',
        label: '高级',
        focus: '语境重构、类别解读与学术名词短语',
        estimatedMinutes: 12,
        objectives: [
          '理解不可数名词的类别化用法',
          '处理集合名词与学术抽象名词',
          '辨析量词搭配和语体差异',
        ],
        rules: [
          {
            title: '类别化转换',
            body: '不可数名词可以在“一个品种、一份成品或一种表现”的解读下转为可数。',
            pattern: 'coffee / two coffees / a fine coffee',
          },
          {
            title: '抽象名词实例化',
            body: 'knowledge、understanding、silence 等可在限定修饰后表达某种具体状态或实例。',
          },
          {
            title: '学术量词搭配',
            body: 'evidence、research、data 的数量表达应符合各自约定，避免机械添加复数。',
          },
          {
            title: '语体与变体',
            body: '口语和行业语境可能扩展可数用法，但正式写作需判断目标语体是否接受。',
          },
        ],
        examples: [
          {
            english: 'The region produces three distinctive coffees.',
            chinese: '该地区出产三种独特的咖啡。',
            practice: {
              prompt: 'The region produces three distinctive ___. (coffee)',
              answers: ['coffees'],
              explanation: '这里指三种咖啡品种，类别化后可以使用复数。',
            },
          },
          {
            english: 'The study offers a nuanced understanding of migration.',
            chinese: '该研究对迁移现象提供了一种细致理解。',
            practice: {
              prompt: 'The study offers ___ nuanced understanding of migration.',
              answers: ['a'],
              explanation: '有形容词限定并表示一种具体理解时，可数化为 a nuanced understanding。',
            },
          },
          {
            english: 'There is compelling evidence for the revised model.',
            chinese: '有强有力的证据支持修订后的模型。',
            practice: {
              prompt: 'There ___ compelling evidence for the revised model.',
              answers: ['is'],
              explanation: 'evidence 通常不可数，谓语使用单数。',
            },
          },
          {
            english: 'Two large coffees, please.',
            chinese: '请来两大杯咖啡。',
            practice: {
              prompt: 'Two large ___, please. (coffee)',
              answers: ['coffees'],
              explanation: '服务场景中 coffees 省略了 cups of，表示两杯。',
            },
          },
          {
            english: 'The archive contains several important works on ecology.',
            chinese: '档案馆收藏了几部重要的生态学著作。',
          },
          {
            english: 'The research generated a substantial amount of data.',
            chinese: '该研究产生了大量数据。',
          },
        ],
        mistakes: [
          {
            wrong: 'The report provides many evidences.',
            right: 'The report provides a great deal of evidence.',
            explanation: '标准正式英语中 evidence 通常不可数。',
            distractors: [
              'The report provides an evidence.',
              'The report provides much evidences.',
            ],
          },
          {
            wrong: 'These research are methodologically weak.',
            right: 'These studies are methodologically weak.',
            explanation: 'research 通常不可数；指多项具体研究时可使用 studies。',
            distractors: [
              'These researches is methodologically weak.',
              'This researches are methodologically weak.',
            ],
          },
          {
            wrong: 'A large number of funding was withdrawn.',
            right: 'A large amount of funding was withdrawn.',
            explanation: 'funding 是不可数名词，搭配 an amount of，而不是 a number of。',
            distractors: [
              'A large number of fundings were withdrawn.',
              'Many funding were withdrawn.',
            ],
          },
        ],
        sources: [source('advanced', '高级', 'Unit 40-41')],
        checks: [
          {
            kind: 'true_false',
            prompt: '不可数名词在表达品种或份数时可能出现复数形式。',
            answer: true,
            explanation: '例如 regional coffees 或 two coffees。',
          },
          {
            kind: 'single_choice',
            prompt: '选择最符合正式学术英语的表达。',
            options: ['many evidences', 'an evidence', 'several evidence', 'a body of evidence'],
            correctIndex: 3,
            explanation: 'a body of evidence 是正式且自然的集合量表达。',
          },
          {
            kind: 'true_false',
            prompt: 'research 在所有英语语体中都必须使用复数 researches。',
            answer: false,
            explanation: '一般学术英语中 research 通常不可数。',
          },
        ],
      },
    ],
  },
  {
    topicId: 'obligation',
    title: 'must、have to与义务',
    english: 'Must, Have To and Obligation',
    overview: '区分说话者施加的必要性、外部规则、禁止和“不必”，并根据时态与语体选择形式。',
    stages: [
      {
        level: 'beginner',
        label: '初级',
        focus: '必须、不必与禁止',
        estimatedMinutes: 8,
        objectives: [
          '使用 must 和 have to 表达必要性',
          '区分 must not 与 do not have to',
          '在过去时中使用 had to',
        ],
        rules: [
          {
            title: '现在的必要性',
            body: 'must 和 have to 都可以表示“必须”；have to 的变化形式更完整。',
            pattern: 'must + base verb / have to + base verb',
          },
          {
            title: '禁止与不必',
            body: 'must not 表示禁止；do not have to 表示没有必要，但仍可选择去做。',
          },
          {
            title: '过去的义务',
            body: '表达过去的必要性通常使用 had to，而不是 musted。',
            pattern: 'had to + base verb',
          },
        ],
        examples: [
          {
            english: 'You must wear a seat belt.',
            chinese: '你必须系安全带。',
            practice: {
              prompt: 'You ___ wear a seat belt.',
              answers: ['must', 'have to'],
              explanation: '两种形式都能表达现在的必要性。',
            },
          },
          {
            english: 'We have to leave before six.',
            chinese: '我们必须在六点前离开。',
            practice: {
              prompt: 'We ___ leave before six. (have)',
              answers: ['have to'],
              explanation: '主语 we 使用 have to。',
            },
          },
          {
            english: 'You must not touch this switch.',
            chinese: '你禁止触碰这个开关。',
            practice: {
              prompt: 'You ___ touch this switch; it is dangerous.',
              answers: ['must not', "mustn't"],
              explanation: '表示禁止使用 must not。',
            },
          },
          {
            english: 'I had to call a taxi last night.',
            chinese: '昨晚我不得不叫出租车。',
            practice: {
              prompt: 'I ___ call a taxi last night. (have)',
              answers: ['had to'],
              explanation: 'last night 表示过去，使用 had to。',
            },
          },
          { english: 'You do not have to bring any food.', chinese: '你不必带食物。' },
          { english: 'Does Leo have to work tomorrow?', chinese: '利奥明天必须工作吗？' },
        ],
        mistakes: [
          {
            wrong: 'You do not have to park here.',
            right: 'You must not park here.',
            explanation: '若意思是“禁止停车”，必须用 must not；do not have to 只是“不必”。',
            distractors: ['You have not park here.', 'You must to not park here.'],
          },
          {
            wrong: 'She musts finish today.',
            right: 'She must finish today.',
            explanation: '情态动词 must 不随第三人称单数加 -s。',
            distractors: ['She must to finish today.', 'She does must finish today.'],
          },
          {
            wrong: 'We musted leave early yesterday.',
            right: 'We had to leave early yesterday.',
            explanation: 'must 没有 musted 形式；过去义务使用 had to。',
            distractors: ['We had leave early yesterday.', 'We did had to leave early yesterday.'],
          },
        ],
        sources: [source('beginner', '初级', 'Unit 31, 33')],
        checks: [
          {
            kind: 'true_false',
            prompt: '“You do not have to come early.” 表示早来是被禁止的。',
            answer: false,
            explanation: '它表示没有必要早来，而不是禁止。',
          },
          {
            kind: 'single_choice',
            prompt: '选择正确的过去义务表达。',
            options: ['I musted wait.', 'I had to wait.', 'I have wait.', 'I did must wait.'],
            correctIndex: 1,
            explanation: '过去的必要性通常使用 had to。',
          },
          {
            kind: 'true_false',
            prompt: 'must 后面直接接动词原形。',
            answer: true,
            explanation: '不能说 must to go 或 must goes。',
          },
        ],
      },
      {
        level: 'intermediate',
        label: '中级',
        focus: '义务来源、时态和语气强弱',
        estimatedMinutes: 10,
        objectives: [
          '比较说话者义务与外部规定',
          '掌握 need not 与 do not need to',
          '表达将来、完成时和推断含义',
        ],
        rules: [
          {
            title: '义务来源',
            body: 'must 常突出说话者认为必要；have to 常突出制度、环境或事实造成的必要性，但实际用法会重叠。',
          },
          {
            title: '形式限制',
            body: '需要不定式、将来时或完成时形式时通常使用 have to。',
            pattern: 'will have to / have had to / to have to',
          },
          {
            title: '没有必要',
            body: 'need not、do not need to 和 do not have to 都可表示不必，语体和地区偏好略有不同。',
          },
          { title: 'must 的推断义', body: 'must 也可表示有把握的逻辑推断，此时并非义务。' },
        ],
        examples: [
          {
            english: 'Employees have to display their badges.',
            chinese: '员工必须佩戴证件。',
            practice: {
              prompt: 'Employees ___ display their badges under company rules.',
              answers: ['have to'],
              explanation: '公司规定属于外部制度，have to 很自然。',
            },
          },
          {
            english: 'We will have to revise the schedule.',
            chinese: '我们将不得不修改日程。',
            practice: {
              prompt: 'We ___ revise the schedule next week. (future)',
              answers: ['will have to'],
              explanation: 'must 没有普通将来形式，使用 will have to。',
            },
          },
          {
            english: 'You need not submit a printed copy.',
            chinese: '你不必提交纸质版。',
            practice: {
              prompt: 'You ___ submit a printed copy; the PDF is enough.',
              answers: [
                'need not',
                "needn't",
                'do not need to',
                "don't need to",
                'do not have to',
                "don't have to",
              ],
              explanation: '这些形式都可表达“没有必要”。',
            },
          },
          {
            english: 'I have had to cancel two meetings.',
            chinese: '我已经不得不取消了两次会议。',
            practice: {
              prompt: 'I ___ cancel two meetings this week. (present perfect)',
              answers: ['have had to'],
              explanation: '完成时使用 have had to。',
            },
          },
          { english: 'That must be the delivery driver.', chinese: '那一定是送货司机。' },
          {
            english: 'Must we decide today?',
            chinese: '我们必须今天决定吗？',
            note: '较正式；日常口语也常用 Do we have to...?。',
          },
        ],
        mistakes: [
          {
            wrong: 'We will must pay a deposit.',
            right: 'We will have to pay a deposit.',
            explanation: 'must 不能直接与 will 连用；将来义务用 will have to。',
            distractors: ['We will to must pay a deposit.', 'We have will pay a deposit.'],
          },
          {
            wrong: 'You must not bring a laptop; tablets are available.',
            right: 'You do not have to bring a laptop; tablets are available.',
            explanation: '这里是“不必携带”而非“禁止携带”。',
            distractors: [
              'You have not to bring a laptop; tablets are available.',
              'You must to bring no laptop; tablets are available.',
            ],
          },
          {
            wrong: 'She has must work late all week.',
            right: 'She has had to work late all week.',
            explanation: '现在完成时的义务使用 has had to。',
            distractors: ['She have had work late all week.', 'She has to worked late all week.'],
          },
        ],
        sources: [source('intermediate', '中级', 'Unit 30-31')],
        checks: [
          {
            kind: 'single_choice',
            prompt: '选择正确的将来义务形式。',
            options: [
              'will must attend',
              'will have to attend',
              'must will attend',
              'will had to attend',
            ],
            correctIndex: 1,
            explanation: '将来义务使用 will have to。',
          },
          {
            kind: 'true_false',
            prompt: 'must 在“That must be Ana.”中表达的是义务。',
            answer: false,
            explanation: '这里表示基于证据的逻辑推断。',
          },
          {
            kind: 'true_false',
            prompt: 'have to 可以构成完成时 have had to。',
            answer: true,
            explanation: 'have to 具有普通动词式的时态变化。',
          },
        ],
      },
      {
        level: 'advanced',
        label: '高级',
        focus: '规范语气、机构话语与过去未实现义务',
        estimatedMinutes: 12,
        objectives: [
          '控制义务表达的权力和礼貌效果',
          '区分 must have done 与 had to do',
          '处理 need not have done 和 did not need to',
        ],
        rules: [
          {
            title: '规范强度与权威',
            body: 'must 可把要求直接归于说话者或文本权威；be required to、be obliged to 常更正式、客观。',
          },
          {
            title: '过去推断与过去义务',
            body: 'must have + 过去分词表示对过去的推断；had to + 动词原形表示过去真实存在的义务。',
          },
          {
            title: '多余但已完成',
            body: 'need not have done 表示事情做了但没有必要；did not need to do 通常只说明没有必要，不必然说明是否做了。',
          },
          {
            title: '弱化命令',
            body: '学术和职场沟通可用 will need to、may need to 或 be expected to 调整直接程度。',
          },
        ],
        examples: [
          {
            english: 'Applicants are required to provide two references.',
            chinese: '申请人须提供两份推荐信息。',
            practice: {
              prompt: 'Applicants ___ provide two references. (formal requirement)',
              answers: ['are required to'],
              explanation: 'be required to 适合正式、客观的规定。',
            },
          },
          {
            english: 'She must have misunderstood the deadline.',
            chinese: '她一定误解了截止日期。',
            practice: {
              prompt: 'She ___ the deadline; otherwise she would be here. (past deduction)',
              answers: ['must have misunderstood'],
              explanation: 'must have + 过去分词表示对过去的强推断。',
            },
          },
          {
            english: 'We had to evacuate the building.',
            chinese: '我们当时不得不撤离大楼。',
            practice: {
              prompt: 'We ___ the building when the alarm sounded. (past obligation)',
              answers: ['had to evacuate'],
              explanation: '过去真实义务使用 had to。',
            },
          },
          {
            english: 'You need not have printed all 200 pages.',
            chinese: '你本来没必要把200页全部打印出来。',
            practice: {
              prompt: 'You ___ all 200 pages; the digital copy was accepted.',
              answers: ['need not have printed', "needn't have printed"],
              explanation: '打印已经发生，但事后发现没有必要。',
            },
          },
          {
            english: 'Teams will need to document any exceptions.',
            chinese: '各团队需要记录所有例外情况。',
          },
          {
            english: 'Participants are expected to remain until the debrief.',
            chinese: '参与者应留到复盘结束。',
          },
        ],
        mistakes: [
          {
            wrong: 'He must leave early yesterday.',
            right: 'He had to leave early yesterday.',
            explanation: '表示昨天实际存在的义务，应使用 had to；must leave 没有过去时标记。',
            distractors: ['He musted leave early yesterday.', 'He has to left early yesterday.'],
          },
          {
            wrong: 'She had to have forgotten the key.',
            right: 'She must have forgotten the key.',
            explanation: '若意思是“她一定忘了钥匙”，这是过去推断，使用 must have forgotten。',
            distractors: ['She must forgot the key.', 'She has must forgotten the key.'],
          },
          {
            wrong: 'I did not need to buy a ticket, but I bought one unnecessarily.',
            right: 'I need not have bought a ticket.',
            explanation: '明确表示“买了但没必要”时，need not have bought 更准确。',
            distractors: ['I need not bought a ticket.', 'I did not had to bought a ticket.'],
          },
        ],
        sources: [source('advanced', '高级', 'Unit 18')],
        checks: [
          {
            kind: 'true_false',
            prompt: 'need not have done 表示动作没有发生。',
            answer: false,
            explanation: '它通常表示动作已经发生，但其实没有必要。',
          },
          {
            kind: 'single_choice',
            prompt: '哪句话表达对过去事件的强推断？',
            options: [
              'They had to leave.',
              'They must leave.',
              'They must have left.',
              'They will have to leave.',
            ],
            correctIndex: 2,
            explanation: 'must have left 表示“他们一定已经离开了”。',
          },
          {
            kind: 'true_false',
            prompt: 'be required to 往往比直接使用 must 更像客观制度规定。',
            answer: true,
            explanation: '被动结构弱化了具体命令者，更适合正式规则。',
          },
        ],
      },
    ],
  },
  {
    topicId: 'passive-forms',
    title: '被动语态的形式与时态',
    english: 'Passive Forms and Tense',
    overview: '用 be + 过去分词保持正确时态，并根据施事者是否重要决定主动或被动表达。',
    stages: [
      {
        level: 'beginner',
        label: '初级',
        focus: '先找 be，再使用过去分词',
        estimatedMinutes: 8,
        objectives: [
          '构成一般现在和一般过去被动',
          '理解主动句宾语如何成为被动句主语',
          '判断何时可以省略 by 短语',
        ],
        rules: [
          {
            title: '基本结构',
            body: '被动语态由适当形式的 be 加过去分词构成。',
            pattern: 'subject + be + past participle',
          },
          {
            title: '时态在 be 上',
            body: 'is/are made 表示现在；was/were made 表示过去。过去分词本身不承担时态。',
          },
          {
            title: '施事者可省略',
            body: '当动作执行者未知、不重要或显而易见时，通常不使用 by 短语。',
          },
        ],
        examples: [
          {
            english: 'The rooms are cleaned every morning.',
            chinese: '房间每天早上都被清洁。',
            practice: {
              prompt: 'The rooms ___ every morning. (clean)',
              answers: ['are cleaned'],
              explanation: '主语是复数 rooms，一般现在时被动使用 are cleaned。',
            },
          },
          {
            english: 'This bridge was built in 1998.',
            chinese: '这座桥建于1998年。',
            practice: {
              prompt: 'This bridge ___ in 1998. (build)',
              answers: ['was built'],
              explanation: '过去时间使用 was，build 的过去分词是 built。',
            },
          },
          {
            english: 'English is spoken in many countries.',
            chinese: '许多国家使用英语。',
            practice: {
              prompt: 'English ___ in many countries. (speak)',
              answers: ['is spoken'],
              explanation: '一般事实使用一般现在时被动 is spoken。',
            },
          },
          {
            english: 'The windows were broken during the storm.',
            chinese: '窗户在暴风雨中被打破了。',
            practice: {
              prompt: 'The windows ___ during the storm. (break)',
              answers: ['were broken'],
              explanation: '复数主语加过去时间，使用 were broken。',
            },
          },
          { english: 'The email was sent by Nora.', chinese: '邮件由诺拉发出。' },
          { english: 'Lunch is served at noon.', chinese: '午餐在中午供应。' },
        ],
        mistakes: [
          {
            wrong: 'The room cleaned every day.',
            right: 'The room is cleaned every day.',
            explanation: '被动语态不能省略 be。',
            distractors: [
              'The room is clean every day by staff.',
              'The room does cleaned every day.',
            ],
          },
          {
            wrong: 'The letters was delivered yesterday.',
            right: 'The letters were delivered yesterday.',
            explanation: '复数主语 letters 在过去时中使用 were。',
            distractors: [
              'The letters were deliver yesterday.',
              'The letters did delivered yesterday.',
            ],
          },
          {
            wrong: 'The cake was make by my brother.',
            right: 'The cake was made by my brother.',
            explanation: 'be 后必须使用过去分词 made，而不是原形 make。',
            distractors: ['The cake made was by my brother.', 'The cake did made by my brother.'],
          },
        ],
        sources: [source('beginner', '初级', 'Unit 21-22')],
        checks: [
          {
            kind: 'true_false',
            prompt: '被动语态的基本结构是 be + 过去分词。',
            answer: true,
            explanation: 'be 承担时态和主谓一致，过去分词表达被动动作。',
          },
          {
            kind: 'single_choice',
            prompt: '选择正确的一般过去时被动句。',
            options: [
              'The door locked last night.',
              'The door was locked last night.',
              'The door was lock last night.',
              'The door did locked last night.',
            ],
            correctIndex: 1,
            explanation: '一般过去时被动使用 was locked。',
          },
          {
            kind: 'true_false',
            prompt: '每个被动句都必须出现 by + 动作执行者。',
            answer: false,
            explanation: '施事者未知或不重要时通常省略。',
          },
        ],
      },
      {
        level: 'intermediate',
        label: '中级',
        focus: '在进行时、完成时和情态结构中保持被动',
        estimatedMinutes: 10,
        objectives: ['构成进行时与完成时被动', '使用情态动词被动', '选择主动或被动的信息焦点'],
        rules: [
          {
            title: '进行时被动',
            body: '把进行体标记放在 be 上，再保留被动分词。',
            pattern: 'am/is/are being + past participle',
          },
          {
            title: '完成时被动',
            body: '完成体使用 have/has been + 过去分词。',
            pattern: 'have/has been + past participle',
          },
          {
            title: '情态被动',
            body: '情态动词后使用 be + 过去分词。',
            pattern: 'modal + be + past participle',
          },
          { title: '信息焦点', body: '当受事者是话题，或施事者未知时，被动语态能保持段落衔接。' },
        ],
        examples: [
          {
            english: 'The road is being repaired.',
            chinese: '道路正在维修。',
            practice: {
              prompt: 'The road ___ at the moment. (repair)',
              answers: ['is being repaired'],
              explanation: '当前进行中的被动动作使用 is being repaired。',
            },
          },
          {
            english: 'The final report has been approved.',
            chinese: '最终报告已经获得批准。',
            practice: {
              prompt: 'The final report ___ already. (approve)',
              answers: ['has been approved'],
              explanation: '单数主语的现在完成时被动使用 has been approved。',
            },
          },
          {
            english: 'All applications must be submitted online.',
            chinese: '所有申请必须在线提交。',
            practice: {
              prompt: 'All applications must ___ online. (submit)',
              answers: ['be submitted'],
              explanation: '情态动词 must 后的被动结构是 be submitted。',
            },
          },
          {
            english: 'The documents had been removed before the audit.',
            chinese: '审计前文件已经被移走。',
            practice: {
              prompt: 'The documents ___ before the audit. (remove)',
              answers: ['had been removed'],
              explanation: '过去完成时被动使用 had been removed。',
            },
          },
          {
            english: 'A new clinic will be opened next spring.',
            chinese: '一家新诊所将于明年春天开业。',
          },
          { english: 'The results were discussed at the meeting.', chinese: '会上讨论了结果。' },
        ],
        mistakes: [
          {
            wrong: 'The system is repaired right now.',
            right: 'The system is being repaired right now.',
            explanation: 'right now 强调动作正在进行，应使用进行时被动。',
            distractors: [
              'The system being repaired right now.',
              'The system is been repaired right now.',
            ],
          },
          {
            wrong: 'The files have deleted.',
            right: 'The files have been deleted.',
            explanation: '完成时被动需要 been。',
            distractors: ['The files has been deleted.', 'The files have being deleted.'],
          },
          {
            wrong: 'The form must submitted today.',
            right: 'The form must be submitted today.',
            explanation: '情态动词后的被动结构不能省略 be。',
            distractors: ['The form must be submit today.', 'The form must been submitted today.'],
          },
        ],
        sources: [source('intermediate', '中级', 'Unit 42-43')],
        checks: [
          {
            kind: 'single_choice',
            prompt: '选择正确的现在完成时被动形式。',
            options: [
              'has completed',
              'has been completed',
              'is been completed',
              'has being completed',
            ],
            correctIndex: 1,
            explanation: '完成时被动是 has/have been + 过去分词。',
          },
          {
            kind: 'true_false',
            prompt: '“The proposal is being reviewed.”表示审查正在进行。',
            answer: true,
            explanation: 'is being reviewed 是现在进行时被动。',
          },
          {
            kind: 'true_false',
            prompt: '情态动词后的被动形式是 modal + been + 过去分词。',
            answer: false,
            explanation: '普通情态被动使用 modal + be + 过去分词。',
          },
        ],
      },
      {
        level: 'advanced',
        label: '高级',
        focus: '复杂被动、报道结构与语篇责任',
        estimatedMinutes: 12,
        objectives: [
          '掌握双宾语和介词被动',
          '使用报道被动组织学术信息',
          '判断被动语态如何隐藏或突出责任',
        ],
        rules: [
          {
            title: '双宾语被动',
            body: 'give、offer、tell 等动词可让间接宾语或直接宾语成为被动主语，选择取决于话题焦点。',
          },
          {
            title: '介词被动',
            body: '固定搭配中的介词通常保留在动词后，如 be referred to、be dealt with。',
          },
          {
            title: '报道被动',
            body: 'It is believed that... 和 subject + be believed to... 可把信息来源背景化。',
          },
          {
            title: '责任与透明度',
            body: '被动语态有时合理突出过程，但也可能不必要地隐藏决策者；正式写作需有意识选择。',
          },
        ],
        examples: [
          {
            english: 'Mina was offered a research position.',
            chinese: '米娜获得了一个研究职位的邀约。',
            practice: {
              prompt: 'Mina ___ a research position. (offer)',
              answers: ['was offered'],
              explanation: '双宾语结构中，接受者 Mina 成为被动主语。',
            },
          },
          {
            english: 'The discrepancy has not yet been accounted for.',
            chinese: '这一差异尚未得到解释。',
            practice: {
              prompt: 'The discrepancy has not yet been ___. (account for)',
              answers: ['accounted for'],
              explanation: '介词 for 保留在过去分词 accounted 后。',
            },
          },
          {
            english: 'The species is believed to have disappeared by 1900.',
            chinese: '据信该物种在1900年前已经消失。',
            practice: {
              prompt: 'The species is believed ___ by 1900. (disappear)',
              answers: ['to have disappeared'],
              explanation: '动作早于 believed 所指时间，使用完成不定式。',
            },
          },
          {
            english: 'It was agreed that the data would remain confidential.',
            chinese: '各方同意数据将保持机密。',
            practice: {
              prompt: 'It ___ that the data would remain confidential. (agree)',
              answers: ['was agreed'],
              explanation: '非人称被动把协议本身置于焦点。',
            },
          },
          {
            english: 'The issue needs to be dealt with immediately.',
            chinese: '这个问题需要立即处理。',
          },
          {
            english: 'Several errors were identified during peer review.',
            chinese: '同行评审期间发现了若干错误。',
          },
        ],
        mistakes: [
          {
            wrong: 'The problem was dealt immediately.',
            right: 'The problem was dealt with immediately.',
            explanation: 'deal with 是不可拆去介词的搭配，被动中仍保留 with。',
            distractors: [
              'The problem dealt with immediately.',
              'The problem was dealing with immediately.',
            ],
          },
          {
            wrong: 'The minister is believed that he resigned.',
            right: 'The minister is believed to have resigned.',
            explanation:
              '以人物为主语的报道被动使用 be believed + 不定式；过去动作使用完成不定式。',
            distractors: [
              'The minister believes to have resigned.',
              'The minister is believing to resigned.',
            ],
          },
          {
            wrong: 'A scholarship was awarded her.',
            right: 'She was awarded a scholarship.',
            explanation: '现代常规表达通常让接受者作主语，或说 A scholarship was awarded to her。',
            distractors: ['She awarded a scholarship.', 'She was award a scholarship.'],
          },
        ],
        sources: [source('advanced', '高级', 'Unit 22-23')],
        checks: [
          {
            kind: 'true_false',
            prompt: '介词动词变为被动时，必要的介词通常保留。',
            answer: true,
            explanation: '例如 The issue was referred to a committee。',
          },
          {
            kind: 'single_choice',
            prompt: '选择正确的过去报道被动。',
            options: [
              'He is thought that left.',
              'He is thought to have left.',
              'He thought to leave.',
              'He is thinking to have left.',
            ],
            correctIndex: 1,
            explanation: 'is thought to have left 表示人们认为他已经离开。',
          },
          {
            kind: 'true_false',
            prompt: '被动语态永远比主动语态更正式、更清楚。',
            answer: false,
            explanation: '被动有助于组织信息，但也可能隐藏责任或使句子含糊。',
          },
        ],
      },
    ],
  },
  {
    topicId: 'defining-relatives',
    title: '限制性关系从句',
    english: 'Defining Relative Clauses',
    overview: '用关系从句识别人或事物，正确选择 who、which、that、whose，并判断关系词能否省略。',
    stages: [
      {
        level: 'beginner',
        label: '初级',
        focus: '用 who、which 和 that 说明“是哪一个”',
        estimatedMinutes: 8,
        objectives: [
          '用 who 指人、which 指物',
          '使用 that 连接限制性信息',
          '避免在从句中重复主语或宾语',
        ],
        rules: [
          {
            title: '从句的作用',
            body: '限制性关系从句提供识别名词所必需的信息，通常不用逗号隔开。',
          },
          {
            title: '关系词选择',
            body: 'who 常指人，which 常指物；that 在许多限制性从句中都可使用。',
            pattern: 'noun + who/which/that + clause',
          },
          {
            title: '不要重复成分',
            body: '关系词已经在从句中担任主语或宾语，不能再添加 he、it、them 等重复代词。',
          },
        ],
        examples: [
          {
            english: 'The woman who lives next door is a doctor.',
            chinese: '住在隔壁的那位女士是医生。',
            practice: {
              prompt: 'The woman ___ lives next door is a doctor.',
              answers: ['who', 'that'],
              explanation: '先行词是人，who 或 that 都可以。',
            },
          },
          {
            english: 'The phone that I bought is already broken.',
            chinese: '我买的那部手机已经坏了。',
            practice: {
              prompt: 'The phone ___ I bought is already broken.',
              answers: ['that', 'which'],
              explanation: '先行词是物，that 或 which 可以作宾语。',
            },
          },
          {
            english: 'Students who arrive late must sign in.',
            chinese: '迟到的学生必须签到。',
            practice: {
              prompt: 'Students ___ arrive late must sign in.',
              answers: ['who', 'that'],
              explanation: '关系词在从句中作主语，不能省略。',
            },
          },
          {
            english: 'This is the book which explains the method.',
            chinese: '这就是解释该方法的书。',
            practice: {
              prompt: 'This is the book ___ explains the method.',
              answers: ['which', 'that'],
              explanation: 'which/that 指代 book 并作 explains 的主语。',
            },
          },
          {
            english: 'The film we watched was funny.',
            chinese: '我们看的那部电影很有趣。',
            note: '宾语关系词可以省略。',
          },
          {
            english: 'I know a café that stays open late.',
            chinese: '我知道一家营业到很晚的咖啡馆。',
          },
        ],
        mistakes: [
          {
            wrong: 'The man who he called is my uncle.',
            right: 'The man who called is my uncle.',
            explanation: 'who 已经作 called 的主语，不能再加 he。',
            distractors: [
              'The man he who called is my uncle.',
              'The man which called is my uncle.',
            ],
          },
          {
            wrong: 'The bag who is on the chair is mine.',
            right: 'The bag that is on the chair is mine.',
            explanation: '先行词 bag 是物，使用 that 或 which，而不是 who。',
            distractors: [
              'The bag what is on the chair is mine.',
              'The bag it is on the chair is mine.',
            ],
          },
          {
            wrong: 'The laptop that I bought it is fast.',
            right: 'The laptop that I bought is fast.',
            explanation: 'that 已经作 bought 的宾语，不能再添加 it。',
            distractors: ['The laptop that I bought it fast.', 'The laptop who I bought is fast.'],
          },
        ],
        sources: [source('beginner', '初级', 'Unit 101-102')],
        checks: [
          {
            kind: 'true_false',
            prompt: '限制性关系从句通常提供识别先行词所必需的信息。',
            answer: true,
            explanation: '去掉后往往无法确定说的是哪一个人或事物。',
          },
          {
            kind: 'single_choice',
            prompt: '选择正确的句子。',
            options: [
              'The teacher who she helped me is kind.',
              'The teacher who helped me is kind.',
              'The teacher which helped me is kind.',
              'The teacher helped who me is kind.',
            ],
            correctIndex: 1,
            explanation: 'who 作从句主语，不再添加 she。',
          },
          {
            kind: 'true_false',
            prompt: '关系词作从句主语时可以随意省略。',
            answer: false,
            explanation: '主语关系词通常不能省略。',
          },
        ],
      },
      {
        level: 'intermediate',
        label: '中级',
        focus: '主语、宾语、省略和 whose',
        estimatedMinutes: 10,
        objectives: ['判断关系词在从句中的成分', '正确省略宾语关系词', '使用 whose 和介词后关系词'],
        rules: [
          { title: '主语不能省略', body: '关系词后直接接动词时，关系词通常是从句主语，不能省略。' },
          {
            title: '宾语可以省略',
            body: '关系词后另有主语时，它往往作宾语；限制性从句中可省略。',
            pattern: 'the report (that) we submitted',
          },
          {
            title: 'whose 表示所属',
            body: 'whose 后接名词，可指人，也可在正式语体中指组织或事物。',
          },
          {
            title: '介词位置',
            body: '日常表达常把介词放句末；正式表达可用 preposition + whom/which，此时不能使用 that。',
          },
        ],
        examples: [
          {
            english: 'The analyst who prepared the chart will present it.',
            chinese: '制作图表的分析师将进行展示。',
            practice: {
              prompt: 'The analyst ___ prepared the chart will present it.',
              answers: ['who', 'that'],
              explanation: '关系词作 prepared 的主语，不能省略。',
            },
          },
          {
            english: 'The chart that the analyst prepared is clear.',
            chinese: '分析师制作的图表很清晰。',
            practice: {
              prompt: 'The chart ___ the analyst prepared is clear.',
              answers: ['that', 'which'],
              explanation:
                '从句已有主语 the analyst，关系词作宾语，可用 that/which；实际句子中也可以省略。',
            },
          },
          {
            english: 'I spoke to a student whose project won first prize.',
            chinese: '我和一位项目获得一等奖的学生交谈了。',
            practice: {
              prompt: 'I spoke to a student ___ project won first prize.',
              answers: ['whose'],
              explanation: 'project 属于 student，使用 whose。',
            },
          },
          {
            english: 'That is the colleague I travelled with.',
            chinese: '那就是和我一起出差的同事。',
            practice: {
              prompt: 'That is the colleague I travelled ___.',
              answers: ['with'],
              explanation: '口语中介词可保留在从句末尾。',
            },
          },
          {
            english: 'The client to whom I wrote has replied.',
            chinese: '我写信联系的客户已经回复。',
          },
          {
            english: 'The policy which affects contractors starts today.',
            chinese: '影响承包商的政策今天生效。',
          },
        ],
        mistakes: [
          {
            wrong: 'The person works here speaks Arabic.',
            right: 'The person who works here speaks Arabic.',
            explanation: '从句缺少主语，必须保留 who/that。',
            distractors: [
              'The person whom works here speaks Arabic.',
              'The person which works here speaks Arabic.',
            ],
          },
          {
            wrong: 'The company who profits increased hired more staff.',
            right: 'The company whose profits increased hired more staff.',
            explanation: 'profits 与 company 是所属关系，使用 whose。',
            distractors: [
              'The company which profits increased hired more staff.',
              'The company whom profits increased hired more staff.',
            ],
          },
          {
            wrong: 'The role for that she applied was filled.',
            right: 'The role for which she applied was filled.',
            explanation: '介词前置时，指物使用 which，不能使用 that。',
            distractors: [
              'The role for who she applied was filled.',
              'The role which she applied for it was filled.',
            ],
          },
        ],
        sources: [source('intermediate', '中级', 'Unit 92-93')],
        checks: [
          {
            kind: 'true_false',
            prompt: '在“The report we submitted”中，省略的关系词作 submitted 的宾语。',
            answer: true,
            explanation: '从句已有主语 we，因此省略的是宾语 that/which。',
          },
          {
            kind: 'single_choice',
            prompt: '选择正确的正式表达。',
            options: [
              'the method with that we worked',
              'the method with which we worked',
              'the method with who we worked',
              'the method which we worked it with',
            ],
            correctIndex: 1,
            explanation: '介词前置并指物时使用 with which。',
          },
          {
            kind: 'true_false',
            prompt: 'whose 只能指人，绝不能指组织。',
            answer: false,
            explanation: 'whose 可用于组织，正式语体中也可用于事物。',
          },
        ],
      },
      {
        level: 'advanced',
        label: '高级',
        focus: '复杂先行词、嵌套结构与语体选择',
        estimatedMinutes: 12,
        objectives: [
          '处理量词 + whom/which',
          '避免复杂从句中的悬垂介词和重复成分',
          '区分限制性结构与补充性结构的标点和含义',
        ],
        rules: [
          {
            title: '量词关系结构',
            body: 'some of whom、many of which 等结构通常属于补充性信息；限制性选择可用 whose、that 或介词结构重写。',
          },
          {
            title: '复杂先行词',
            body: '关系词应紧邻并清楚指向先行词，避免把从句放在可能产生歧义的位置。',
          },
          {
            title: '嵌套与插入语',
            body: 'I think、we believe 等插入成分不会改变关系词在更深层从句中的语法功能。',
          },
          {
            title: '限制性与补充性',
            body: '限制性从句不用逗号并限定集合；补充性从句用逗号添加说明，通常不用 that。',
          },
        ],
        examples: [
          {
            english: 'Candidates whose applications lack evidence will be contacted.',
            chinese: '申请材料缺少证据的候选人将收到联系。',
            practice: {
              prompt: 'Candidates ___ applications lack evidence will be contacted.',
              answers: ['whose'],
              explanation: 'whose 引出限定候选人范围的所属关系。',
            },
          },
          {
            english: 'The framework within which the data were interpreted is contested.',
            chinese: '解释这些数据所依据的框架存在争议。',
            practice: {
              prompt: 'The framework ___ which the data were interpreted is contested.',
              answers: ['within'],
              explanation: '正式介词关系结构使用 within which。',
            },
          },
          {
            english: 'This is the researcher whom I believe the panel selected.',
            chinese: '这就是我认为评审组选中的研究者。',
            practice: {
              prompt: 'This is the researcher ___ I believe the panel selected.',
              answers: ['whom', 'who', 'that'],
              explanation: '关系词在 selected 后作宾语；I believe 是插入层。',
            },
          },
          {
            english: 'The only proposal that met all criteria was funded.',
            chinese: '唯一满足全部标准的方案获得了资助。',
            practice: {
              prompt: 'The only proposal ___ met all criteria was funded.',
              answers: ['that'],
              explanation: 'the only 后的限制性从句通常优先使用 that。',
            },
          },
          {
            english: 'The teams with which we collaborated shared their data.',
            chinese: '与我们合作的团队共享了数据。',
          },
          {
            english: 'A device that many users find difficult to configure needs redesigning.',
            chinese: '许多用户认为难以配置的设备需要重新设计。',
          },
        ],
        mistakes: [
          {
            wrong: 'The report that its conclusions were disputed was withdrawn.',
            right: 'The report whose conclusions were disputed was withdrawn.',
            explanation: 'conclusions 属于 report，使用 whose，不能使用 that + its 双重表达。',
            distractors: [
              'The report which its conclusions were disputed was withdrawn.',
              'The report whom conclusions were disputed was withdrawn.',
            ],
          },
          {
            wrong: 'The candidate whom I think is most qualified should lead.',
            right: 'The candidate who I think is most qualified should lead.',
            explanation: '关系词是 is most qualified 的主语，即使中间有 I think，也使用 who。',
            distractors: [
              'The candidate which I think is most qualified should lead.',
              'The candidate who I think he is most qualified should lead.',
            ],
          },
          {
            wrong: 'The only route which avoids the tunnel is closed.',
            right: 'The only route that avoids the tunnel is closed.',
            explanation: 'the only 后的限制性关系从句通常使用 that，更符合常规语体选择。',
            distractors: [
              'The only route what avoids the tunnel is closed.',
              'The only route that it avoids the tunnel is closed.',
            ],
          },
        ],
        sources: [source('advanced', '高级', 'Unit 53-54')],
        checks: [
          {
            kind: 'true_false',
            prompt: '插入语 I think 会自动把关系词从主格变成宾格。',
            answer: false,
            explanation: '格取决于关系词在其所属从句中的功能，而不是插入语。',
          },
          {
            kind: 'single_choice',
            prompt: '选择没有重复所属标记的句子。',
            options: [
              'the firm that its policy changed',
              'the firm whose policy changed',
              'the firm which its policy changed',
              'the firm who policy changed',
            ],
            correctIndex: 1,
            explanation: 'whose 本身表达所属，不再加 its。',
          },
          {
            kind: 'true_false',
            prompt: '限制性关系从句和补充性关系从句的标点差异可能改变所指范围。',
            answer: true,
            explanation: '逗号会把信息改为补充说明，而非限定集合。',
          },
        ],
      },
    ],
  },
];

export const grammarContentVersion = 'grammar-pilot-2026-07-v1';
export const pilotGrammarTopicIds = lessons.map((lesson) => lesson.topicId);

const lessonById = new Map(lessons.map((lesson) => [lesson.topicId, lesson]));
const questions = lessons.flatMap((lesson) =>
  lesson.stages.flatMap((stage) => buildQuestions(lesson.topicId, stage)),
);
const questionById = new Map(questions.map((question) => [question.id, question]));

export function getPilotGrammarLesson(topicId: string): GrammarLesson | null {
  const lesson = lessonById.get(topicId);
  if (!lesson) return null;
  return {
    topicId: lesson.topicId,
    title: lesson.title,
    english: lesson.english,
    overview: lesson.overview,
    pilot: true,
    stages: lesson.stages.map((stage) => toStage(lesson.topicId, stage)),
  };
}

export function getGrammarQuestionDefinitions(
  topicId: string,
  level: GrammarLevelId,
): GrammarQuestionDefinition[] {
  return questions.filter((question) => question.topicId === topicId && question.level === level);
}

export function getGrammarQuestionDefinition(questionId: string): GrammarQuestionDefinition | null {
  return questionById.get(questionId) ?? null;
}

export function toPublicGrammarQuestion(
  question: GrammarQuestionDefinition,
): GrammarPublicQuestion {
  return {
    id: question.id,
    kind: question.kind,
    prompt: question.prompt,
    instruction: question.instruction,
    ...(question.options ? { options: question.options } : {}),
  };
}

export function isGrammarAnswerCorrect(
  question: GrammarQuestionDefinition,
  answer: string,
): boolean {
  if (question.kind === 'fill_blank') {
    return (question.acceptedAnswers ?? [question.correctAnswer])
      .map(normalizeAnswer)
      .includes(normalizeAnswer(answer));
  }
  return answer === question.correctAnswer;
}

export function grammarCorrectAnswerLabel(question: GrammarQuestionDefinition): string {
  if (question.kind === 'fill_blank')
    return question.acceptedAnswers?.[0] ?? question.correctAnswer;
  return (
    question.options?.find((option) => option.id === question.correctAnswer)?.label ??
    question.correctAnswer
  );
}

export function validateGrammarPilotContent(): {
  lessonCount: number;
  stageCount: number;
  questionCount: number;
} {
  if (lessons.length !== 5) throw new Error(`Expected 5 pilot lessons, found ${lessons.length}.`);
  const topicIds = new Set(lessons.map((lesson) => lesson.topicId));
  if (topicIds.size !== lessons.length) throw new Error('Duplicate pilot grammar topic id.');
  for (const lesson of lessons) {
    const levels = lesson.stages.map((stage) => stage.level).join(',');
    if (levels !== 'beginner,intermediate,advanced') {
      throw new Error(`Invalid stage order for ${lesson.topicId}: ${levels}`);
    }
    for (const stage of lesson.stages) {
      toStage(lesson.topicId, stage);
      const stageQuestions = getGrammarQuestionDefinitions(lesson.topicId, stage.level);
      if (stageQuestions.length !== 10) {
        throw new Error(
          `Expected 10 questions for ${lesson.topicId}:${stage.level}, found ${stageQuestions.length}.`,
        );
      }
    }
  }
  if (questions.length !== 150)
    throw new Error(`Expected 150 questions, found ${questions.length}.`);
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error('Duplicate pilot grammar question id.');
  }
  return {
    lessonCount: lessons.length,
    stageCount: lessons.length * 3,
    questionCount: questions.length,
  };
}

validateGrammarPilotContent();
