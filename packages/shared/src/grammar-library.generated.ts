// Generated from apps/web/data/grammar-library.json.
// Run "pnpm grammar:generate" after rebuilding the grammar library.
const grammarLibraryData = {
  parts: [
    {
      topics: [
        {
          id: 'complete-sentence',
          title: '认识一个完整句子',
          english: 'Complete Sentence Structure',
          overview: '一个完整句子通常需要：',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '认识一个完整句子',
              content: [
                '完整句子的三个条件：一个完整句子通常需要：',
                '主语 Subject：主语是句子中做动作的人、事物或概念。',
                '谓语动词 Verb：谓语动词表示主语的动作或状态，并且通常带有时态或人称变化。',
                '宾语 Object：宾语是动作影响的对象。',
                '补语 Complement：补语用来说明主语或宾语的身份、名称或状态。',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 3–4 页',
              },
            },
          ],
          examples: [
            {
              english: 'The student reads the book.',
              chinese: '',
              note: '完整句子的三个条件',
            },
            {
              english: 'The student = 主语',
              chinese: '',
              note: '完整句子的三个条件',
            },
            {
              english: 'reads = 谓语动词',
              chinese: '',
              note: '完整句子的三个条件',
            },
            {
              english: 'the book = 宾语',
              chinese: '',
              note: '完整句子的三个条件',
            },
            {
              english: 'The teacher explains the rule.',
              chinese: '',
              note: '主语 Subject',
            },
            {
              english: '主语：The teacher',
              chinese: '',
              note: '主语有时很长。不要把离动词最近的名词自动当成主语。',
            },
            {
              english: 'The color of the walls is blue.',
              chinese: '',
              note: '真正主语：color；of the walls 只是修饰主语。',
            },
            {
              english: 'The room is quiet.',
              chinese: '',
              note: '谓语动词 Verb',
            },
            {
              english: 'explains 和 is 都是谓语。',
              chinese: '',
              note: '谓语动词 Verb',
            },
            {
              english: 'The student opened the door.',
              chinese: '',
              note: '宾语 Object',
            },
            {
              english: 'student = 主语；opened = 谓语；door = 宾语。',
              chinese: '',
              note: '宾语 Object',
            },
            {
              english: 'The test was difficult.',
              chinese: '',
              note: '补语 Complement',
            },
            {
              english: 'They called the dog Max.',
              chinese: '',
              note: '补语 Complement',
            },
            {
              english: 'difficult 说明 test；Max 说明 the dog 的名字。',
              chinese: '',
              note: '补语 Complement',
            },
          ],
          mistakes: [],
          related: [],
        },
        {
          id: 'phrases-and-clauses',
          title: '短语和从句',
          english: 'Phrases and Clauses',
          overview: '短语是一组单词，但没有完整的“主语 + 谓语”结构，因此一般不能单独成为句子。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '短语和从句',
              content: [
                '短语 Phrase：短语是一组单词，但没有完整的“主语 + 谓语”结构，因此一般不能单独成为句子。',
                '从句 Clause：从句通常含有主语和谓语。',
                '独立从句 Independent Clause：独立从句可以单独成为完整句子。',
                '从属从句 Dependent Clause：从属从句虽然有主语和谓语，但因为前面有从属连词，不能单独成为完整句子。',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 4–5 页',
              },
            },
          ],
          examples: [
            {
              english: 'in the room',
              chinese: '',
              note: '短语 Phrase',
            },
            {
              english: 'after the class',
              chinese: '',
              note: '短语 Phrase',
            },
            {
              english: 'to read the book',
              chinese: '',
              note: '短语 Phrase',
            },
            {
              english: 'running in the park',
              chinese: '',
              note: '短语 Phrase',
            },
            {
              english: 'After the class, the students went home.',
              chinese: '',
              note: '短语 Phrase',
            },
            {
              english: 'the student finished the test',
              chinese: '',
              note: '从句 Clause',
            },
            {
              english: 'student = 主语；finished = 谓语。',
              chinese: '',
              note: '从句 Clause',
            },
            {
              english: 'The student finished the test.',
              chinese: '',
              note: '独立从句 Independent Clause',
            },
            {
              english: 'Because the student was tired',
              chinese: '',
              note: '这句话没有说明“所以发生了什么”。',
            },
            {
              english: 'Because the student was tired, he went home.',
              chinese: '',
              note: '常见从属连词：',
            },
            {
              english: '• because（因为）',
              chinese: '',
              note: '从属从句 Dependent Clause',
            },
            {
              english: '• although / though / even though（虽然）',
              chinese: '',
              note: '从属从句 Dependent Clause',
            },
            {
              english: '• when / while（当……时）',
              chinese: '',
              note: '从属从句 Dependent Clause',
            },
            {
              english: '• after / before（在……之后／之前）',
              chinese: '',
              note: '从属从句 Dependent Clause',
            },
            {
              english: '• if / unless（如果／除非）',
              chinese: '',
              note: '从属从句 Dependent Clause',
            },
            {
              english: '• since / until（自从／直到）',
              chinese: '',
              note: '从属从句 Dependent Clause',
            },
          ],
          mistakes: [
            {
              wrong: 'After the class.',
              right: 'After the class, the students went home.',
              explanation: '短语 Phrase',
            },
          ],
          related: [],
        },
        {
          id: 'sentence-types',
          title: '四种基本句子',
          english: 'Four Basic Sentence Types',
          overview: '只有一个独立从句。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '四种基本句子',
              content: [
                '简单句：只有一个独立从句。',
                '并列句：含有两个或更多独立从句。',
                '复合句：一个独立从句加至少一个从属从句。',
                '并列复合句：至少有两个独立从句，同时还有从属从句。',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 5 页',
              },
            },
          ],
          examples: [
            {
              english: 'The boy opened the window.',
              chinese: '',
              note: '简单句',
            },
            {
              english: 'The boy opened the window, and the girl closed the door.',
              chinese: '',
              note: '两边都可以单独成为完整句子。',
            },
            {
              english: 'Because it was hot, the boy opened the window.',
              chinese: '',
              note: '复合句',
            },
            {
              english:
                'Because it was hot, the boy opened the window, and the girl turned on the fan.',
              chinese: '',
              note: '并列复合句',
            },
          ],
          mistakes: [],
          related: [],
        },
        {
          id: 'joining-independent-clauses',
          title: '连接两个完整句子',
          english: 'Joining Independent Clauses',
          overview:
            '先判断空格左右是否都是完整句子。若两边都完整，就必须使用能够连接两个独立从句的结构。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '连接两个完整句子',
              content: [
                '核心问题：先判断空格左右是否都是完整句子。若两边都完整，就必须使用能够连接两个独立从句的结构。',
                '使用句号：The test was hard. Many students finished it.',
                '使用分号：The test was hard; many students finished it.',
                '公式：完整句；完整句。分号两边必须都能单独成句。',
                '逗号加并列连词：The test was hard, but many students finished it.',
                '公式：完整句，FANBOYS 完整句。',
                '分号加连接副词：The test was hard; however, many students finished it.',
                '公式：完整句；however，完整句。也可以把分号改成句号。',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 5–6 页',
              },
            },
          ],
          examples: [
            {
              english: 'The test was hard. Many students finished it.',
              chinese: '',
              note: '使用句号',
            },
            {
              english: 'The test was hard; many students finished it.',
              chinese: '',
              note: '使用分号',
            },
            {
              english: 'because 后面是从属从句，不能放在分号后独立存在。',
              chinese: '',
              note: '公式',
            },
            {
              english: 'The test was hard, but many students finished it.',
              chinese: '',
              note: '逗号加并列连词',
            },
            {
              english: 'FANBOYS：',
              chinese: '',
              note: '• for = 因为',
            },
            {
              english: 'The test was hard; however, many students finished it.',
              chinese: '',
              note: '分号加连接副词',
            },
            {
              english:
                '常见连接副词：however, therefore, moreover, instead, still, also, as a result。',
              chinese: '',
              note: '公式',
            },
            {
              english: 'The test was hard. However, many students finished it.',
              chinese: '',
              note: '公式',
            },
          ],
          mistakes: [
            {
              wrong: 'The test was hard, however, many students finished it.',
              right: 'The test was hard. However, many students finished it.',
              explanation: '公式',
            },
          ],
          related: [],
        },
        {
          id: 'sentence-boundary-errors',
          title: '常见句子错误',
          english: 'Sentence Boundary Errors',
          overview: '只用一个逗号连接两个完整句子。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '常见句子错误',
              content: [
                'Comma Splice：逗号拼接：只用一个逗号连接两个完整句子。',
                'Run-on Sentence：粘连句：两个完整句子之间没有正确标点或连接词。',
                'Sentence Fragment：残句：句子缺少主语、谓语或完整意思。',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 7 页',
              },
            },
          ],
          examples: [
            {
              english: 'The room was cold, so I closed the window.',
              chinese: '',
              note: 'Comma Splice：逗号拼接',
            },
            {
              english: 'The room was cold; I closed the window.',
              chinese: '',
              note: 'Comma Splice：逗号拼接',
            },
            {
              english: 'The room was cold. I closed the window.',
              chinese: '',
              note: 'Comma Splice：逗号拼接',
            },
            {
              english: 'Because the room was cold, I closed the window.',
              chinese: '',
              note: 'Sentence Fragment：残句',
            },
          ],
          mistakes: [
            {
              wrong: 'The room was cold, I closed the window.',
              right: 'The room was cold. I closed the window.',
              explanation: 'Comma Splice：逗号拼接',
            },
            {
              wrong: 'The room was cold I closed the window.',
              right: 'The room was cold, so I closed the window.',
              explanation: 'Run-on Sentence：粘连句',
            },
            {
              wrong: 'Because the room was cold.',
              right: 'Because the room was cold, I closed the window.',
              explanation: 'Sentence Fragment：残句',
            },
          ],
          related: [],
        },
        {
          id: 'dependent-and-main-clauses',
          title: '从属从句和主句',
          english: 'Dependent and Main Clauses',
          overview: '从属从句，完整句。句首从属从句后通常使用逗号。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '从属从句和主句',
              content: [
                '从属从句在前：Because the road was wet, the driver moved slowly.',
                '公式：从属从句，完整句。句首从属从句后通常使用逗号。',
                '主句在前：The driver moved slowly because the road was wet.',
                'Although 和 But 不要重复：错误：Although the test was hard, but the student finished it.',
                'Because 和 So 不要重复：错误：Because it was raining, so we stayed home.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 7–8 页',
              },
            },
          ],
          examples: [
            {
              english: 'Because the road was wet, the driver moved slowly.',
              chinese: '',
              note: '从属从句在前',
            },
            {
              english: 'The driver moved slowly because the road was wet.',
              chinese: '',
              note: '主句在前、后面的从属从句提供必要原因时，because 前通常不用逗号。',
            },
            {
              english: 'Although the test was hard, the student finished it.',
              chinese: '',
              note: 'Although 和 But 不要重复',
            },
            {
              english: 'The test was hard, but the student finished it.',
              chinese: '',
              note: 'Although 和 But 不要重复',
            },
            {
              english: 'Because it was raining, we stayed home.',
              chinese: '',
              note: 'Because 和 So 不要重复',
            },
            {
              english: 'It was raining, so we stayed home.',
              chinese: '',
              note: 'Because 和 So 不要重复',
            },
          ],
          mistakes: [
            {
              wrong: 'Although the test was hard, but the student finished it.',
              right: 'The test was hard, but the student finished it.',
              explanation: 'Although 和 But 不要重复',
            },
            {
              wrong: 'Because it was raining, so we stayed home.',
              right: 'It was raining, so we stayed home.',
              explanation: 'Because 和 So 不要重复',
            },
          ],
          related: [],
        },
      ],
    },
    {
      topics: [
        {
          id: 'colons',
          title: '冒号 Colon',
          english: 'Colons',
          overview: '冒号用于解释、举例、列出内容或给出具体信息。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '冒号 Colon',
              content: [
                '本章要点：冒号用于解释、举例、列出内容或给出具体信息。',
                '完整句加解释：The class had one main rule: students had to arrive on time.',
                '完整句加列表：We need three things: food, water, and time.',
                '冒号规则：冒号前必须是完整句子；冒号后可以是词、短语、列表或完整句。',
                '动词和宾语之间不能加冒号：错误：We need: food, water, and time.',
                '介词和宾语之间不能加冒号：错误：The book is about: art, music, and history.',
                'such as 后通常不用冒号：错误：The shop sells fruit, such as: apples and oranges.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 8–9 页',
              },
            },
          ],
          examples: [
            {
              english: 'The class had one main rule: students had to arrive on time.',
              chinese: '',
              note: '完整句加解释',
            },
            {
              english: 'We need three things: food, water, and time.',
              chinese: '',
              note: '完整句加列表',
            },
            {
              english: 'We need food, water, and time.',
              chinese: '',
              note: '动词和宾语之间不能加冒号',
            },
            {
              english: 'The book is about art, music, and history.',
              chinese: '',
              note: '介词和宾语之间不能加冒号',
            },
            {
              english: 'The shop sells fruit, such as apples and oranges.',
              chinese: '',
              note: 'such as 后通常不用冒号',
            },
          ],
          mistakes: [
            {
              wrong: 'We need: food, water, and time.',
              right: 'We need three things: food, water, and time.',
              explanation: '动词和宾语之间不能加冒号',
            },
            {
              wrong: 'The book is about: art, music, and history.',
              right: 'The book is about art, music, and history.',
              explanation: '介词和宾语之间不能加冒号',
            },
            {
              wrong: 'The shop sells fruit, such as: apples and oranges.',
              right: 'The shop sells fruit, such as apples and oranges.',
              explanation: 'such as 后通常不用冒号',
            },
          ],
          related: [],
        },
        {
          id: 'dashes',
          title: '破折号 Dash',
          english: 'Dashes',
          overview: '学习破折号 Dash的 SAT 核心用法。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '破折号 Dash',
              content: [
                '一个破折号：引出解释或强调：The student made one mistake - he forgot his name.',
                '两个破折号：插入补充信息：The student - who was very tired - made a mistake.',
                '插入标点必须成对：错误：The student - who was very tired, made a mistake.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 9 页',
              },
            },
          ],
          examples: [
            {
              english: 'The student made one mistake - he forgot his name.',
              chinese: '',
              note: '一个破折号：引出解释或强调',
            },
            {
              english: 'The student - who was very tired - made a mistake.',
              chinese: '',
              note: '两个破折号：插入补充信息',
            },
            {
              english: '删除中间内容后：The student made a mistake.',
              chinese: '',
              note: '两个破折号：插入补充信息',
            },
            {
              english: 'The student, who was very tired, made a mistake.',
              chinese: '',
              note: '插入标点必须成对',
            },
          ],
          mistakes: [
            {
              wrong: 'The student - who was very tired, made a mistake.',
              right: 'The student, who was very tired, made a mistake.',
              explanation: '插入标点必须成对',
            },
          ],
          related: [],
        },
        {
          id: 'commas',
          title: '逗号 Comma',
          english: 'Commas',
          overview: '学习逗号 Comma的 SAT 核心用法。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '逗号 Comma',
              content: [
                '句首短语后使用逗号：After the class, the students went home.',
                '非必要信息使用成对逗号：Tom, who lives next door, is a teacher.',
                '必要信息不用逗号：Students who study often get better results.',
                '同位语：Lisa, my best friend, lives in New York.',
                '列表中的逗号：I bought bread, milk, and fruit.',
                '并列形容词：It was a long, difficult test.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 9–10 页',
              },
            },
          ],
          examples: [
            {
              english: 'After the class, the students went home.',
              chinese: '',
              note: '句首短语后使用逗号',
            },
            {
              english: 'In the morning, I read the news.',
              chinese: '',
              note: '句首短语后使用逗号',
            },
            {
              english: 'Tired after work, Mia went to bed.',
              chinese: '',
              note: '句首短语后使用逗号',
            },
            {
              english: 'Tom, who lives next door, is a teacher.',
              chinese: '',
              note: '非必要信息使用成对逗号',
            },
            {
              english: '删除 who lives next door 后，主句仍完整。',
              chinese: '',
              note: '非必要信息使用成对逗号',
            },
            {
              english: 'Students who study often get better results.',
              chinese: '',
              note: '必要信息不用逗号',
            },
            {
              english: 'who study 决定具体是哪一类 students，不能删除。',
              chinese: '',
              note: '必要信息不用逗号',
            },
            {
              english: 'Lisa, my best friend, lives in New York.',
              chinese: '',
              note: '同位语',
            },
            {
              english: 'my best friend 重新说明 Lisa 的身份。',
              chinese: '',
              note: '同位语',
            },
            {
              english: 'I bought bread, milk, and fruit.',
              chinese: '',
              note: '列表中的逗号',
            },
            {
              english: 'It was a long, difficult test.',
              chinese: '',
              note: '并列形容词',
            },
            {
              english: '可以改成 a long and difficult test，两个形容词地位相同。',
              chinese: '',
              note: '并列形容词',
            },
            {
              english: 'a small wooden table 通常不用逗号，因为 small 与 wooden 属于不同层次。',
              chinese: '',
              note: '并列形容词',
            },
          ],
          mistakes: [],
          related: [],
        },
        {
          id: 'comma-restrictions',
          title: '不能加逗号的位置',
          english: 'Where Commas Do Not Belong',
          overview: '学习不能加逗号的位置的 SAT 核心用法。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '不能加逗号的位置',
              content: [
                '主语和谓语之间：错误：The students in the room, are reading.',
                '动词和宾语之间：错误：The teacher explained, the rule.',
                '介词和宾语之间：错误：The book is on, the table.',
                '同一个主语的两个动作之间：错误：The student opened the book, and started reading.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 10 页',
              },
            },
          ],
          examples: [
            {
              english: 'The students in the room are reading.',
              chinese: '',
              note: '主语和谓语之间',
            },
            {
              english: 'The teacher explained the rule.',
              chinese: '',
              note: '动词和宾语之间',
            },
            {
              english: 'The book is on the table.',
              chinese: '',
              note: '介词和宾语之间',
            },
            {
              english: 'The student opened the book and started reading.',
              chinese: '',
              note: '同一个主语的两个动作之间',
            },
            {
              english:
                '有新主语时：The student opened the book, and the teacher started the class.',
              chinese: '',
              note: '同一个主语的两个动作之间',
            },
          ],
          mistakes: [
            {
              wrong: 'The students in the room, are reading.',
              right: 'The students in the room are reading.',
              explanation: '主语和谓语之间',
            },
            {
              wrong: 'The teacher explained, the rule.',
              right: 'The teacher explained the rule.',
              explanation: '动词和宾语之间',
            },
            {
              wrong: 'The book is on, the table.',
              right: 'The book is on the table.',
              explanation: '介词和宾语之间',
            },
            {
              wrong: 'The student opened the book, and started reading.',
              right: 'The student opened the book and started reading.',
              explanation: '同一个主语的两个动作之间',
            },
          ],
          related: [],
        },
      ],
    },
    {
      topics: [
        {
          id: 'subject-verb-agreement',
          title: '主谓一致',
          english: 'Subject-Verb Agreement',
          overview: '单数主语使用单数动词；复数主语使用复数动词。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '主谓一致',
              content: [
                '基本规则：单数主语使用单数动词；复数主语使用复数动词。',
                '不要被中间的名词影响：The box of books is heavy.',
                'of 后面的名词通常不是主语：The color of the walls is blue.',
                '插入内容不改变主语：The teacher, along with her students, is in the room.',
                'and 连接两个主语：Tom and Lisa are students.',
                'Either/or 和 Neither/nor：动词通常与离它最近的主语一致。',
                'Each 和 Every：Each student has a book.',
                '常见单数不定代词：everyone, everybody, someone, somebody, anyone, anybody, no one, nobody, each, either, neither',
                'A number of 与 The number of：A number of students are absent.（许多学生）',
                'There is / There are：there 不是主语，真正主语在后面。',
                '时间、金钱和距离作为整体：Ten years is a long time.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 11–12 页',
              },
            },
          ],
          examples: [
            {
              english: 'The student reads every day.',
              chinese: '',
              note: '基本规则',
            },
            {
              english: 'The students read every day.',
              chinese: '',
              note: '基本规则',
            },
            {
              english: 'The box of books is heavy.',
              chinese: '',
              note: '不要被中间的名词影响',
            },
            {
              english: 'The books in the box are old.',
              chinese: '',
              note: '第一句主语是 box；第二句主语是 books。',
            },
            {
              english: 'The color of the walls is blue.',
              chinese: '',
              note: 'of 后面的名词通常不是主语',
            },
            {
              english: 'The effects of the change are clear.',
              chinese: '',
              note: 'of 后面的名词通常不是主语',
            },
            {
              english: 'The teacher, along with her students, is in the room.',
              chinese: '',
              note: '插入内容不改变主语',
            },
            {
              english:
                '类似结构：along with, together with, as well as, in addition to, including。',
              chinese: '',
              note: '插入内容不改变主语',
            },
            {
              english: 'Tom and Lisa are students.',
              chinese: '',
              note: 'and 连接两个主语',
            },
            {
              english: 'Either the teachers or the student is coming.',
              chinese: '',
              note: 'Either/or 和 Neither/nor',
            },
            {
              english: 'Either the student or the teachers are coming.',
              chinese: '',
              note: 'Either/or 和 Neither/nor',
            },
            {
              english: 'Each student has a book.',
              chinese: '',
              note: 'Each 和 Every',
            },
            {
              english: 'Every student is ready.',
              chinese: '',
              note: 'Each 和 Every',
            },
            {
              english: 'Each of the students has a book.',
              chinese: '',
              note: 'Each 和 Every',
            },
            {
              english:
                'everyone, everybody, someone, somebody, anyone, anybody, no one, nobody, each, either, neither',
              chinese: '',
              note: '通常视为单数。',
            },
            {
              english: 'Everyone is ready.',
              chinese: '',
              note: '常见单数不定代词',
            },
            {
              english: 'Someone has opened the door.',
              chinese: '',
              note: '常见单数不定代词',
            },
            {
              english: 'A number of students are absent.（许多学生）',
              chinese: '',
              note: 'A number of 与 The number of',
            },
            {
              english: 'The number of students is growing.（学生的数量）',
              chinese: '',
              note: 'A number of 与 The number of',
            },
            {
              english: 'there 不是主语，真正主语在后面。',
              chinese: '',
              note: 'There is / There are',
            },
            {
              english: 'There is a book on the table.',
              chinese: '',
              note: 'There is / There are',
            },
            {
              english: 'There are three books on the table.',
              chinese: '',
              note: 'There is / There are',
            },
            {
              english: 'Ten years is a long time.',
              chinese: '',
              note: '时间、金钱和距离作为整体',
            },
            {
              english: 'Twenty dollars is enough.',
              chinese: '',
              note: '时间、金钱和距离作为整体',
            },
            {
              english: 'Five miles is too far.',
              chinese: '',
              note: '时间、金钱和距离作为整体',
            },
          ],
          mistakes: [],
          related: [],
        },
        {
          id: 'finite-and-nonfinite-verbs',
          title: '谓语与非谓语动词',
          english: 'Finite and Nonfinite Verbs',
          overview:
            '完整句必须有真正的谓语动词。-ing、过去分词和 to do 往往只是非谓语，不能单独承担整句谓语。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '谓语与非谓语动词',
              content: [
                '本章要点：完整句必须有真正的谓语动词。-ing、过去分词和 to do 往往只是非谓语，不能单独承担整句谓语。',
                '真正的谓语：The student studies every day.',
                '-ing 形式不能总是单独作谓语：错误：The student studying in the library.',
                '过去分词不能总是单独作谓语：错误：The book written by Tom.',
                '两个谓语之间必须有连接：错误：The student opened the book started reading.',
                '不定式：形式：to + 动词原形。常用于表示目的。',
                '动名词：动词加 -ing 可以像名词一样作主语或宾语。',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 12–13 页',
              },
            },
          ],
          examples: [
            {
              english: 'The student studies every day.',
              chinese: '',
              note: '真正的谓语',
            },
            {
              english: 'The students are studying.',
              chinese: '',
              note: '真正的谓语',
            },
            {
              english: 'studies 和 are studying 都是完整谓语。',
              chinese: '',
              note: '真正的谓语',
            },
            {
              english: 'The student is studying in the library.',
              chinese: '',
              note: '-ing 形式不能总是单独作谓语',
            },
            {
              english: 'The student studying in the library is my friend.',
              chinese: '',
              note: '-ing 形式不能总是单独作谓语',
            },
            {
              english: 'The book was written by Tom.',
              chinese: '',
              note: '过去分词不能总是单独作谓语',
            },
            {
              english: 'The book written by Tom is popular.',
              chinese: '',
              note: '过去分词不能总是单独作谓语',
            },
            {
              english: 'The student opened the book and started reading.',
              chinese: '',
              note: '两个谓语之间必须有连接',
            },
            {
              english: 'She went to the library to study.',
              chinese: '',
              note: '不定式',
            },
            {
              english: 'Reading is useful.',
              chinese: '',
              note: '动名词',
            },
            {
              english: 'She enjoys reading.',
              chinese: '',
              note: '动名词',
            },
          ],
          mistakes: [
            {
              wrong: 'The student studying in the library.',
              right: 'The student studying in the library is my friend.',
              explanation: '-ing 形式不能总是单独作谓语',
            },
            {
              wrong: 'The book written by Tom.',
              right: 'The book written by Tom is popular.',
              explanation: '过去分词不能总是单独作谓语',
            },
            {
              wrong: 'The student opened the book started reading.',
              right: 'The student opened the book and started reading.',
              explanation: '两个谓语之间必须有连接',
            },
          ],
          related: [],
        },
        {
          id: 'verb-tense',
          title: '动词时态',
          english: 'Verb Tense',
          overview: '先建立时间线，再选择动词。不要因为某个时态“看起来高级”就选它。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '动词时态',
              content: [
                '做题原则：先建立时间线，再选择动词。不要因为某个时态“看起来高级”就选它。',
                '一般现在时：用于事实、经常发生的动作、现在状态和文章观点。',
                '一般过去时：表示过去已经完成的事情。',
                '现在完成时：结构：has/have + 过去分词。表示过去开始或发生、与现在有关的事情。',
                '过去完成时：结构：had + 过去分词。用于两个过去动作中更早发生的动作。',
                '进行时：结构：be + 动词-ing。强调动作正在进行。',
                '时态保持一致：错误：She opened the door and walks into the room.',
                '根据时间词判断：Since 2020, the school has added five new classes.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 13–14 页',
              },
            },
          ],
          examples: [
            {
              english: 'Water freezes at 0°C.',
              chinese: '',
              note: '一般现在时',
            },
            {
              english: 'She walks to school every day.',
              chinese: '',
              note: '一般现在时',
            },
            {
              english: 'The writer argues that the rule is unfair.',
              chinese: '',
              note: '一般现在时',
            },
            {
              english: 'The class started at nine yesterday.',
              chinese: '',
              note: '一般过去时',
            },
            {
              english: 'The team won the game last week.',
              chinese: '',
              note: '一般过去时',
            },
            {
              english: '常见时间词：yesterday, last year, in 2020, two days ago。',
              chinese: '',
              note: '一般过去时',
            },
            {
              english: 'Scientists have studied the problem for many years.',
              chinese: '',
              note: '现在完成时',
            },
            {
              english: 'She has lived here since 2020.',
              chinese: '',
              note: '现在完成时',
            },
            {
              english: '常见提示：since, for, recently, so far, over the past few years。',
              chinese: '',
              note: '现在完成时',
            },
            {
              english: 'By the time the class started, Mia had finished her work.',
              chinese: '',
              note: '先完成工作，后开始上课。',
            },
            {
              english: 'The students are taking the test.',
              chinese: '',
              note: '进行时',
            },
            {
              english: 'He was reading when I called.',
              chinese: '',
              note: '进行时',
            },
            {
              english: 'She opened the door and walked into the room.',
              chinese: '',
              note: '时态保持一致',
            },
            {
              english: 'Since 2020, the school has added five new classes.',
              chinese: '',
              note: '根据时间词判断',
            },
            {
              english: 'In 2020, the school added five new classes.',
              chinese: '',
              note: '根据时间词判断',
            },
          ],
          mistakes: [
            {
              wrong: 'She opened the door and walks into the room.',
              right: 'She opened the door and walked into the room.',
              explanation: '时态保持一致',
            },
          ],
          related: [],
        },
      ],
    },
    {
      topics: [
        {
          id: 'pronouns',
          title: '代词',
          english: 'Pronouns',
          overview: '→',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '代词',
              content: [
                '代词与名词数量一致：The student finished his work.',
                '代词指代必须清楚：不清楚：When Anna met Lisa, she was tired.',
                '主格代词：I, he, she, we, they, who 用作主语。',
                '宾格代词：me, him, her, us, them, whom 用在动词或介词之后。',
                '反身代词：myself, yourself, himself, herself, itself, ourselves, themselves 用于动作返回主语或强调。',
                'Who 和 Whom：Who wrote the book?',
                'Who、Which 和 That：The man who called me is my teacher.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 15–16 页',
              },
            },
          ],
          examples: [
            {
              english: 'The student finished his work.',
              chinese: '',
              note: '代词与名词数量一致',
            },
            {
              english: 'The students finished their work.',
              chinese: '',
              note: '代词与名词数量一致',
            },
            {
              english: 'Anna was tired when she met Lisa.',
              chinese: '',
              note: '代词指代必须清楚',
            },
            {
              english: 'I, he, she, we, they, who 用作主语。',
              chinese: '',
              note: '主格代词',
            },
            {
              english: 'Tom and I went home.',
              chinese: '',
              note: '主格代词',
            },
            {
              english: '去掉 Tom 后仍是 I went home。',
              chinese: '',
              note: '主格代词',
            },
            {
              english: 'me, him, her, us, them, whom 用在动词或介词之后。',
              chinese: '',
              note: '宾格代词',
            },
            {
              english: 'The teacher helped Tom and me.',
              chinese: '',
              note: '宾格代词',
            },
            {
              english: '去掉 Tom 后仍是 The teacher helped me。',
              chinese: '',
              note: '宾格代词',
            },
            {
              english:
                'myself, yourself, himself, herself, itself, ourselves, themselves 用于动作返回主语或强调。',
              chinese: '',
              note: '反身代词',
            },
            {
              english: 'She taught herself English.',
              chinese: '',
              note: '反身代词',
            },
            {
              english: 'The teacher herself wrote the book.',
              chinese: '',
              note: '反身代词',
            },
            {
              english: 'Please call John or me.',
              chinese: '',
              note: '反身代词',
            },
            {
              english: 'Who wrote the book?',
              chinese: '',
              note: 'Who 和 Whom',
            },
            {
              english: 'He wrote the book.',
              chinese: '',
              note: '→',
            },
            {
              english: 'Whom did you call?',
              chinese: '',
              note: 'Who 和 Whom',
            },
            {
              english: 'I called him.',
              chinese: '',
              note: '→',
            },
            {
              english: 'The man who called me is my teacher.',
              chinese: '',
              note: 'Who、Which 和 That',
            },
            {
              english: 'The book, which is very old, is valuable.',
              chinese: '',
              note: 'Who、Which 和 That',
            },
            {
              english: 'The book that I bought is useful.',
              chinese: '',
              note: 'Who、Which 和 That',
            },
          ],
          mistakes: [
            {
              wrong: 'When Anna met Lisa, she was tired.',
              right: 'Anna was tired when she met Lisa.',
              explanation: '代词指代必须清楚',
            },
            {
              wrong: 'Please call John or myself.',
              right: 'Please call John or me.',
              explanation: '反身代词',
            },
          ],
          related: [],
        },
        {
          id: 'possessives-and-plurals',
          title: '所有格和复数',
          english: 'Possessives and Plurals',
          overview: '→',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '所有格和复数',
              content: [
                '普通复数：student',
                "单数所有格：the student's book",
                "复数所有格：the students' books",
                "不规则复数所有格：children's books",
                "Its 与 It's：The dog moved its tail.（its = 它的）",
                "Their / They're / There：The students finished their work.",
                "Your / You're：Your answer is correct.",
                "Whose / Who's：Whose book is this?",
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 16–17 页',
              },
            },
          ],
          examples: [
            {
              english: 'student',
              chinese: '',
              note: '普通复数',
            },
            {
              english: 'students',
              chinese: '',
              note: '→',
            },
            {
              english: 'book',
              chinese: '',
              note: '普通复数',
            },
            {
              english: 'books',
              chinese: '',
              note: '→',
            },
            {
              english: 'class',
              chinese: '',
              note: '普通复数',
            },
            {
              english: 'classes',
              chinese: '',
              note: '→',
            },
            {
              english: 'city',
              chinese: '',
              note: '普通复数',
            },
            {
              english: 'cities',
              chinese: '',
              note: '→',
            },
            {
              english: 'Three students came.',
              chinese: '',
              note: '普通复数',
            },
            {
              english: "the student's book",
              chinese: '',
              note: '含义：一个学生的书。',
            },
            {
              english: "the students' books",
              chinese: '',
              note: '复数所有格',
            },
            {
              english: 'students 已经以 s 结尾，所以只加撇号。',
              chinese: '',
              note: '复数所有格',
            },
            {
              english: "children's books",
              chinese: '',
              note: '不规则复数所有格',
            },
            {
              english: "women's work",
              chinese: '',
              note: '不规则复数所有格',
            },
            {
              english: "people's ideas",
              chinese: '',
              note: '不规则复数所有格',
            },
            {
              english: 'The dog moved its tail.（its = 它的）',
              chinese: '',
              note: "Its 与 It's",
            },
            {
              english: "It's cold today.（it's = it is）",
              chinese: '',
              note: "Its 与 It's",
            },
            {
              english: 'The students finished their work.',
              chinese: '',
              note: "Their / They're / There",
            },
            {
              english: "They're ready.（They are ready.）",
              chinese: '',
              note: "Their / They're / There",
            },
            {
              english: 'The books are over there.',
              chinese: '',
              note: "Their / They're / There",
            },
            {
              english: 'There are two books on the table.',
              chinese: '',
              note: "Their / They're / There",
            },
            {
              english: 'Your answer is correct.',
              chinese: '',
              note: "Your / You're",
            },
            {
              english: "You're correct.（You are correct.）",
              chinese: '',
              note: "Your / You're",
            },
            {
              english: 'Whose book is this?',
              chinese: '',
              note: "Whose / Who's",
            },
            {
              english: "Who's at the door?（Who is at the door?）",
              chinese: '',
              note: "Whose / Who's",
            },
          ],
          mistakes: [
            {
              wrong: "Three student's came.",
              right: 'Three students came.',
              explanation: '普通复数',
            },
          ],
          related: [],
        },
        {
          id: 'modifiers',
          title: '修饰语',
          english: 'Modifiers',
          overview: '核心规则',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '修饰语',
              content: [
                '本章要点：核心规则',
                '句首 -ing 修饰语：错误：Walking to school, the rain started.',
                '过去分词修饰语：Built in 1900, the house is very old.',
                '修饰语靠近名词：不清楚：The teacher gave the book to the student with a red cover.',
                'Only 的位置会改变意思：Only Lisa answered the question.（只有 Lisa 回答）',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 17–18 页',
              },
            },
          ],
          examples: [
            {
              english: 'Walking to school, Mia saw that it had started to rain.',
              chinese: '',
              note: '句首 -ing 修饰语',
            },
            {
              english: 'Built in 1900, the house is very old.',
              chinese: '',
              note: '过去分词修饰语',
            },
            {
              english: 'Built in 1900, the house is still visited by many people.',
              chinese: '',
              note: '过去分词修饰语',
            },
            {
              english: 'The teacher gave the student the book with a red cover.',
              chinese: '',
              note: '修饰语靠近名词',
            },
            {
              english: 'Only Lisa answered the question.（只有 Lisa 回答）',
              chinese: '',
              note: 'Only 的位置会改变意思',
            },
            {
              english: 'Lisa only answered the question.（Lisa 只做了回答这一动作）',
              chinese: '',
              note: 'Only 的位置会改变意思',
            },
            {
              english: 'Lisa answered only the first question.（只回答第一题）',
              chinese: '',
              note: 'Only 的位置会改变意思',
            },
          ],
          mistakes: [
            {
              wrong: 'Walking to school, the rain started.',
              right: 'Walking to school, Mia saw that it had started to rain.',
              explanation: '句首 -ing 修饰语',
            },
            {
              wrong: 'Built in 1900, people still visit the house.',
              right: 'Built in 1900, the house is still visited by many people.',
              explanation: '过去分词修饰语',
            },
            {
              wrong: 'The teacher gave the book to the student with a red cover.',
              right: 'The teacher gave the student the book with a red cover.',
              explanation: '修饰语靠近名词',
            },
          ],
          related: [],
        },
        {
          id: 'restrictive-information',
          title: '限制性和非限制性信息',
          english: 'Restrictive and Nonrestrictive Information',
          overview: '限制性信息决定具体指哪一个人或哪一类事物，不能删除，因此通常不加逗号。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '限制性和非限制性信息',
              content: [
                '限制性信息：限制性信息决定具体指哪一个人或哪一类事物，不能删除，因此通常不加逗号。',
                '非限制性信息：非限制性信息只是补充说明，删除后主要意思仍完整，因此使用成对逗号、破折号或括号。',
                '删除测试：The school, which opened in 1990, has many students.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 18 页',
              },
            },
          ],
          examples: [
            {
              english: 'Students who arrive late cannot enter.',
              chinese: '',
              note: '限制性信息',
            },
            {
              english: 'Lisa, who arrived late, could not enter.',
              chinese: '',
              note: '非限制性信息',
            },
            {
              english: 'The school, which opened in 1990, has many students.',
              chinese: '',
              note: '删除测试',
            },
            {
              english: '删除后：The school has many students.',
              chinese: '',
              note: '主句仍完整，所以中间内容是补充信息。',
            },
          ],
          mistakes: [],
          related: [],
        },
        {
          id: 'parallel-structure',
          title: '平行结构',
          english: 'Parallel Structure',
          overview: '核心规则',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '平行结构',
              content: [
                '本章要点：核心规则',
                '列表形式一致：错误：She likes reading, swimming, and to run.',
                '动词形式一致：The class helps students read clearly, write well, and speak with confidence.',
                'Both A and B：The book is both useful and easy to read.',
                'Either A or B：We can either walk or take the bus.',
                'Not only A but also B：The plan is not only simple but also useful.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 18–19 页',
              },
            },
          ],
          examples: [
            {
              english: 'She likes reading, swimming, and running.',
              chinese: '',
              note: '列表形式一致',
            },
            {
              english: 'She likes to read, to swim, and to run.',
              chinese: '',
              note: '列表形式一致',
            },
            {
              english:
                'The class helps students read clearly, write well, and speak with confidence.',
              chinese: '',
              note: '动词形式一致',
            },
            {
              english: 'The book is both useful and easy to read.',
              chinese: '',
              note: 'Both A and B',
            },
            {
              english: 'We can either walk or take the bus.',
              chinese: '',
              note: 'Either A or B',
            },
            {
              english: 'The plan is not only simple but also useful.',
              chinese: '',
              note: 'Not only A but also B',
            },
            {
              english: 'The plan not only saves time but also reduces cost.',
              chinese: '',
              note: 'Not only A but also B',
            },
          ],
          mistakes: [
            {
              wrong: 'She likes reading, swimming, and to run.',
              right: 'She likes to read, to swim, and to run.',
              explanation: '列表形式一致',
            },
            {
              wrong: 'The plan is not only simple but also saves time.',
              right: 'The plan not only saves time but also reduces cost.',
              explanation: 'Not only A but also B',
            },
          ],
          related: [],
        },
        {
          id: 'comparisons',
          title: '比较结构',
          english: 'Comparisons',
          overview: '学习比较结构的 SAT 核心用法。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '比较结构',
              content: [
                '比较同类事物：错误：The weather in New York is colder than California.',
                '单数用 that，复数用 those：The cost of this car is lower than that of the other car.',
                '比较意思必须清楚：不清楚：Tom likes Anna more than Lisa.',
                '比较级和最高级：Of the two books, this one is better.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 19–20 页',
              },
            },
          ],
          examples: [
            {
              english: 'The weather in New York is colder than the weather in California.',
              chinese: '',
              note: '比较同类事物',
            },
            {
              english: 'The weather in New York is colder than that in California.',
              chinese: '',
              note: '比较同类事物',
            },
            {
              english: 'The cost of this car is lower than that of the other car.',
              chinese: '',
              note: '单数用 that，复数用 those',
            },
            {
              english: 'The books in this class are easier than those in the other class.',
              chinese: '',
              note: '单数用 that，复数用 those',
            },
            {
              english: '意思一：Tom likes Anna more than he likes Lisa.',
              chinese: '',
              note: '比较意思必须清楚',
            },
            {
              english: '意思二：Tom likes Anna more than Lisa does.',
              chinese: '',
              note: '比较意思必须清楚',
            },
            {
              english: 'Of the two books, this one is better.',
              chinese: '',
              note: '比较级和最高级',
            },
            {
              english: 'Of the five books, this one is the best.',
              chinese: '',
              note: '比较级和最高级',
            },
          ],
          mistakes: [
            {
              wrong: 'The weather in New York is colder than California.',
              right: 'The weather in New York is colder than that in California.',
              explanation: '比较同类事物',
            },
          ],
          related: [],
        },
        {
          id: 'adjectives-and-adverbs',
          title: '形容词和副词',
          english: 'Adjectives and Adverbs',
          overview: '学习形容词和副词的 SAT 核心用法。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '形容词和副词',
              content: [
                '形容词修饰名词：a careful student',
                '副词修饰动词：The student answered carefully.',
                '副词修饰形容词或其他副词：The test was very difficult.',
                '系动词后通常用形容词：常见系动词：be, seem, look, feel, sound, become, remain。',
                'Good 和 Well：She is a good writer.',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 20 页',
              },
            },
          ],
          examples: [
            {
              english: 'a careful student',
              chinese: '',
              note: '形容词修饰名词',
            },
            {
              english: 'a difficult test',
              chinese: '',
              note: '形容词修饰名词',
            },
            {
              english: 'The student answered carefully.',
              chinese: '',
              note: '副词修饰动词',
            },
            {
              english: 'She spoke clearly.',
              chinese: '',
              note: '副词修饰动词',
            },
            {
              english: 'The test was very difficult.',
              chinese: '',
              note: '副词修饰形容词或其他副词',
            },
            {
              english: 'The plan was highly successful.',
              chinese: '',
              note: '副词修饰形容词或其他副词',
            },
            {
              english: '常见系动词：be, seem, look, feel, sound, become, remain。',
              chinese: '',
              note: '系动词后通常用形容词',
            },
            {
              english: 'The food smells good.',
              chinese: '',
              note: '系动词后通常用形容词',
            },
            {
              english: 'The plan seems useful.',
              chinese: '',
              note: '系动词后通常用形容词',
            },
            {
              english: 'She is a good writer.',
              chinese: '',
              note: 'Good 和 Well',
            },
            {
              english: 'She writes well.',
              chinese: '',
              note: 'Good 和 Well',
            },
          ],
          mistakes: [],
          related: [],
        },
        {
          id: 'count-and-noncount-nouns',
          title: '可数和不可数名词',
          english: 'Count and Noncount Nouns',
          overview: '学习可数和不可数名词的 SAT 核心用法。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '可数和不可数名词',
              content: [
                '可数名词：可以直接数：book, student, test, idea, class。',
                '不可数名词：常见不可数名词：information, advice, research, evidence, knowledge, water, money。',
                'Many 和 Much：many books（可数）',
                'Fewer 和 Less：fewer students（可数）',
                'Number 和 Amount：the number of students',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 20–21 页',
              },
            },
          ],
          examples: [
            {
              english: '可以直接数：book, student, test, idea, class。',
              chinese: '',
              note: '可数名词',
            },
            {
              english: 'one book',
              chinese: '',
              note: '可数名词',
            },
            {
              english: 'two books',
              chinese: '',
              note: '可数名词',
            },
            {
              english: 'many students',
              chinese: '',
              note: '可数名词',
            },
            {
              english: 'fewer classes',
              chinese: '',
              note: '可数名词',
            },
            {
              english:
                '常见不可数名词：information, advice, research, evidence, knowledge, water, money。',
              chinese: '',
              note: '不可数名词',
            },
            {
              english: 'much information',
              chinese: '',
              note: '不可数名词',
            },
            {
              english: 'a piece of advice',
              chinese: '',
              note: '不可数名词',
            },
            {
              english: 'many books（可数）',
              chinese: '',
              note: 'Many 和 Much',
            },
            {
              english: 'much information（不可数）',
              chinese: '',
              note: 'Many 和 Much',
            },
            {
              english: 'fewer students（可数）',
              chinese: '',
              note: 'Fewer 和 Less',
            },
            {
              english: 'less time（不可数）',
              chinese: '',
              note: 'Fewer 和 Less',
            },
            {
              english: 'the number of students',
              chinese: '',
              note: 'Number 和 Amount',
            },
            {
              english: 'the amount of water',
              chinese: '',
              note: 'Number 和 Amount',
            },
          ],
          mistakes: [
            {
              wrong: 'many informations',
              right: 'a piece of advice',
              explanation: '不可数名词',
            },
            {
              wrong: 'an advice',
              right: 'a piece of advice',
              explanation: '不可数名词',
            },
          ],
          related: [],
        },
        {
          id: 'articles',
          title: '冠词',
          english: 'Articles',
          overview: '用于一个不特指的单数可数名词。使用 a 还是 an 主要看后面的发音。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '冠词',
              content: [
                'A 和 An：用于一个不特指的单数可数名词。使用 a 还是 an 主要看后面的发音。',
                'The：the 表示特定的人或事物，或前文已经提到的对象。',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 21–22 页',
              },
            },
          ],
          examples: [
            {
              english: 'a book',
              chinese: '',
              note: 'A 和 An',
            },
            {
              english: 'a student',
              chinese: '',
              note: 'A 和 An',
            },
            {
              english: 'an apple',
              chinese: '',
              note: 'A 和 An',
            },
            {
              english: 'an idea',
              chinese: '',
              note: 'A 和 An',
            },
            {
              english: 'an hour',
              chinese: '',
              note: 'A 和 An',
            },
            {
              english: 'a university',
              chinese: '',
              note: 'A 和 An',
            },
            {
              english: 'the 表示特定的人或事物，或前文已经提到的对象。',
              chinese: '',
              note: 'The',
            },
            {
              english: 'I bought a book. The book was expensive.',
              chinese: '',
              note: '第一次提到用 a，第二次指同一本书用 the。',
            },
          ],
          mistakes: [],
          related: [],
        },
      ],
    },
    {
      topics: [
        {
          id: 'transitions',
          title: '逻辑连接词',
          english: 'Logical Transitions',
          overview:
            '先忽略选项，判断后一句与前一句是补充、转折、结果、举例、相似、解释还是顺序关系。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '逻辑连接词',
              content: [
                '做题方法：先忽略选项，判断后一句与前一句是补充、转折、结果、举例、相似、解释还是顺序关系。',
                '补充：also, moreover, furthermore, in addition, besides',
                '转折：however, yet, still, nevertheless, on the other hand, by contrast',
                '结果：therefore, thus, as a result, so, for this reason',
                '举例：for example, for instance, such as',
                '相似：similarly, likewise, in the same way',
                '顺序：first, next, then, later, finally, meanwhile, before, after',
                '解释：in other words, that is, in fact, more clearly',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 22–23 页',
              },
            },
          ],
          examples: [
            {
              english: 'also, moreover, furthermore, in addition, besides',
              chinese: '',
              note: '补充',
            },
            {
              english: 'The plan is simple. Moreover, it is cheap.',
              chinese: '',
              note: '补充',
            },
            {
              english: 'however, yet, still, nevertheless, on the other hand, by contrast',
              chinese: '',
              note: '转折',
            },
            {
              english: 'The test was hard. However, most students passed.',
              chinese: '',
              note: '转折',
            },
            {
              english: 'therefore, thus, as a result, so, for this reason',
              chinese: '',
              note: '结果',
            },
            {
              english: 'It rained all day. Therefore, the game was stopped.',
              chinese: '',
              note: '结果',
            },
            {
              english: 'for example, for instance, such as',
              chinese: '',
              note: '举例',
            },
            {
              english: 'Many animals live in groups. For example, wolves often live together.',
              chinese: '',
              note: '举例',
            },
            {
              english: 'similarly, likewise, in the same way',
              chinese: '',
              note: '相似',
            },
            {
              english:
                'Tom enjoys reading. Similarly, his sister spends much of her free time with books.',
              chinese: '',
              note: '相似',
            },
            {
              english: 'first, next, then, later, finally, meanwhile, before, after',
              chinese: '',
              note: '顺序',
            },
            {
              english: 'in other words, that is, in fact, more clearly',
              chinese: '',
              note: '解释',
            },
            {
              english: 'The test is optional. In other words, students do not have to take it.',
              chinese: '',
              note: '解释',
            },
          ],
          mistakes: [],
          related: [],
        },
        {
          id: 'sat-grammar-traps',
          title: '高频 SAT 语法陷阱',
          english: 'Common SAT Grammar Traps',
          overview: '学习高频 SAT 语法陷阱的 SAT 核心用法。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '高频 SAT 语法陷阱',
              content: [
                '陷阱一：离动词最近的名词不一定是主语：The group of students is ready. 主语是 group。',
                '陷阱二：句子很长，不代表主干复杂：The effects of the new rule on students in large schools are clear. 主语 effects；谓语 are。',
                '陷阱三：一个逗号不能连接两个完整句子：错误：The test ended, the students left.',
                '陷阱四：分号两边必须完整：错误：The students left; after the test.',
                '陷阱五：冒号前必须完整：错误：The class includes: reading and writing.',
                '陷阱六：插入信息的标点要成对：正确：The teacher, who came from Canada, works here.',
                '陷阱七：看到复数名词，不要马上选复数动词：Each of the students is ready. 主语是 each。',
                '陷阱八：看到 -ing，不要认为它一定是谓语：The students studying in the room are quiet. 真正谓语是 are。',
                '陷阱九：不要只靠中文翻译判断时态：Since 2020, she has worked here.',
                '陷阱十：修饰语必须和主语匹配：错误：After reading the book, the movie seemed boring. 正确：After reading the book, Mia thought',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 23–24 页',
              },
            },
          ],
          examples: [
            {
              english: 'The group of students is ready. 主语是 group。',
              chinese: '',
              note: '陷阱一：离动词最近的名词不一定是主语',
            },
            {
              english:
                'The effects of the new rule on students in large schools are clear. 主语 effects；谓语 are。',
              chinese: '',
              note: '陷阱二：句子很长，不代表主干复杂',
            },
            {
              english: 'The teacher, who came from Canada, works here.',
              chinese: '',
              note: '陷阱六：插入信息的标点要成对',
            },
            {
              english: 'Each of the students is ready. 主语是 each。',
              chinese: '',
              note: '陷阱七：看到复数名词，不要马上选复数动词',
            },
            {
              english: 'The students studying in the room are quiet. 真正谓语是 are。',
              chinese: '',
              note: '陷阱八：看到 -ing，不要认为它一定是谓语',
            },
            {
              english: 'Since 2020, she has worked here.',
              chinese: '',
              note: '陷阱九：不要只靠中文翻译判断时态',
            },
            {
              english: 'the movie was boring.',
              chinese: '',
              note: '陷阱十：修饰语必须和主语匹配',
            },
          ],
          mistakes: [],
          related: [],
        },
        {
          id: 'sat-grammar-workflow',
          title: 'SAT 语法做题步骤',
          english: 'SAT Grammar Workflow',
          overview: '判断空格左右各有几个独立从句。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: 'SAT 语法做题步骤',
              content: [
                '第一步：找到真正的主语：忽略 of 短语、介词短语和插入语。例：The result of the tests is clear. 主语是 result。',
                '第二步：找到真正的谓语：例：The student sitting by the door is my friend. 真正谓语是 is。',
                '第三步：数完整句子：判断空格左右各有几个独立从句。',
                '第四步：检查标点：逗号是否误连两个完整句？冒号前是否完整？分号两边是否完整？插入标点是否成对？',
                '第五步：检查动词：主谓是否一致？时态是否符合时间线？句子是否缺谓语？',
                '第六步：检查代词：代词指谁？单复数是否一致？应使用主格还是宾格？',
                '第七步：检查修饰语：句首动作是谁做的？修饰语是否靠近正确名词？',
                '第八步：最后检查句意：逻辑、时间、比较对象和前后连贯性是否合理？',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 24–25 页',
              },
            },
          ],
          examples: [
            {
              english:
                '忽略 of 短语、介词短语和插入语。例：The result of the tests is clear. 主语是 result。',
              chinese: '',
              note: '第一步：找到真正的主语',
            },
            {
              english: '例：The student sitting by the door is my friend. 真正谓语是 is。',
              chinese: '',
              note: '第二步：找到真正的谓语',
            },
          ],
          mistakes: [],
          related: [],
        },
        {
          id: 'essential-formulas',
          title: '必须熟记的公式',
          english: 'Essential Formulas',
          overview: '结构',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '必须熟记的公式',
              content: ['本章要点：结构'],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 25 页',
              },
            },
          ],
          examples: [],
          mistakes: [],
          related: [],
        },
        {
          id: 'study-priorities',
          title: '学习优先顺序与总结',
          english: 'Study Priorities and Summary',
          overview:
            '找主语 → 找谓语 → 数完整句 → 判断连接方式 → 检查动词 → 检查修饰语 → 检查代词 → 检查单复数和所有格 → 最后检查句意。',
          patterns: [],
          levels: [
            {
              id: 'beginner',
              label: 'SAT核心',
              focus: '学习优先顺序与总结',
              content: [
                '第一阶段：句子基础：• 主语',
                '第二阶段：标点：• 句号',
                '第三阶段：动词：• 主谓一致',
                '第四阶段：句子细节：• 代词',
                '第五阶段：逻辑：• 补充',
                '最终总结：SAT 语法的核心不是难词，而是句子结构。遇到任何题目，都按照以下顺序分析：',
                '固定分析流程：找主语 → 找谓语 → 数完整句 → 判断连接方式 → 检查动词 → 检查修饰语 → 检查代词 → 检查单复数和所有格 → 最后检查句意。',
              ],
              source: {
                level: 'SAT 3000词汇量版',
                rangeLabel: '第 25–26 页',
              },
            },
          ],
          examples: [
            {
              english: '• 逗号 + FANBOYS',
              chinese: '',
              note: '• 冒号',
            },
            {
              english: 'SAT 语法的核心不是难词，而是句子结构。遇到任何题目，都按照以下顺序分析：',
              chinese: '',
              note: '最终总结',
            },
          ],
          mistakes: [],
          related: [],
        },
      ],
    },
  ],
} as const;

export default grammarLibraryData;
