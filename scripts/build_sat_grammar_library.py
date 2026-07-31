#!/usr/bin/env python3
"""Build the SAT grammar library from the 3000-word PDF source."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import fitz


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "source" / "语法书" / "SAT语法知识点大全_3000词汇量版.pdf"
DEFAULT_OUTPUT = ROOT / "apps" / "web" / "data" / "grammar-library.json"

CHAPTERS = (
    ("complete-sentence", "Complete Sentence Structure", 1, "3–4"),
    ("phrases-and-clauses", "Phrases and Clauses", 1, "4–5"),
    ("sentence-types", "Four Basic Sentence Types", 1, "5"),
    ("joining-independent-clauses", "Joining Independent Clauses", 1, "5–6"),
    ("sentence-boundary-errors", "Sentence Boundary Errors", 1, "7"),
    ("dependent-and-main-clauses", "Dependent and Main Clauses", 1, "7–8"),
    ("colons", "Colons", 2, "8–9"),
    ("dashes", "Dashes", 2, "9"),
    ("commas", "Commas", 2, "9–10"),
    ("comma-restrictions", "Where Commas Do Not Belong", 2, "10"),
    ("subject-verb-agreement", "Subject-Verb Agreement", 3, "11–12"),
    ("finite-and-nonfinite-verbs", "Finite and Nonfinite Verbs", 3, "12–13"),
    ("verb-tense", "Verb Tense", 3, "13–14"),
    ("pronouns", "Pronouns", 4, "15–16"),
    ("possessives-and-plurals", "Possessives and Plurals", 4, "16–17"),
    ("modifiers", "Modifiers", 4, "17–18"),
    ("restrictive-information", "Restrictive and Nonrestrictive Information", 4, "18"),
    ("parallel-structure", "Parallel Structure", 4, "18–19"),
    ("comparisons", "Comparisons", 4, "19–20"),
    ("adjectives-and-adverbs", "Adjectives and Adverbs", 4, "20"),
    ("count-and-noncount-nouns", "Count and Noncount Nouns", 4, "20–21"),
    ("articles", "Articles", 4, "21–22"),
    ("transitions", "Logical Transitions", 5, "22–23"),
    ("sat-grammar-traps", "Common SAT Grammar Traps", 5, "23–24"),
    ("sat-grammar-workflow", "SAT Grammar Workflow", 5, "24–25"),
    ("essential-formulas", "Essential Formulas", 5, "25"),
    ("study-priorities", "Study Priorities and Summary", 5, "25–26"),
)

MODULES = (
    (
        "sentence-foundations",
        "句子基础",
        "Sentence Foundations",
        "先找主语和谓语，再判断短语、从句、句型与句子边界。",
    ),
    (
        "punctuation",
        "标点与句子边界",
        "Punctuation and Sentence Boundaries",
        "用冒号、破折号和逗号表达正确的句法关系。",
    ),
    (
        "verbs",
        "动词系统",
        "The Verb System",
        "检查主谓一致、谓语与非谓语，并根据时间线选择时态。",
    ),
    (
        "sentence-details",
        "句子细节",
        "Sentence Details",
        "处理代词、所有格、修饰语、平行、比较、词性与名词。",
    ),
    (
        "logic-and-strategy",
        "逻辑与做题策略",
        "Logic and Test Strategy",
        "判断句间逻辑，掌握高频陷阱、固定分析流程和必记公式。",
    ),
)

SPECIAL_HEADINGS = {
    "核心问题",
    "基本规则",
    "冒号规则",
    "公式",
    "做题原则",
    "做题方法",
    "固定分析流程",
    "最终总结",
}

# The PDF is intentionally concise. These guides turn its rules and examples into a
# repeatable SAT analysis method without bringing back the retired practice system.
CHAPTER_GUIDES: dict[str, dict[str, list[str]]] = {
    "complete-sentence": {
        "goals": [
            "确认句子是否同时具备主语、限定动词和完整意思。",
            "区分真正的谓语与分词、不定式等非谓语形式。",
            "在长句中找到主干，而不被修饰成分干扰。",
        ],
        "steps": [
            "圈出所有动词形式，先找带时态或情态的限定动词。",
            "为每个限定动词找到对应主语，再暂时划掉介词短语和插入语。",
            "只读剩余主干，检查它能否独立表达完整意思。",
        ],
        "traps": [
            "看到 -ing 或过去分词就误认为已有谓语。",
            "句子很长就默认完整，忽略主语或谓语缺失。",
            "把从属从句误当成可以独立成句的主句。",
        ],
    },
    "phrases-and-clauses": {
        "goals": [
            "区分短语、从属从句与独立从句。",
            "根据主语和限定动词判断结构层级。",
            "识别一个句子中真正需要连接的从句。",
        ],
        "steps": [
            "先标出限定动词，再为每个动词寻找主语。",
            "有主谓组合时继续检查是否由 because、when、who 等词引导。",
            "能独立表达完整意思的是独立从句；不能独立的是从属从句或短语。",
        ],
        "traps": [
            "把含有名词和动词形式的短语误判为从句。",
            "忽略关系词或从属连词，使从属从句看起来像主句。",
            "只按长度判断结构，不检查限定动词。",
        ],
    },
    "sentence-types": {
        "goals": [
            "识别简单句、并列句、复合句和并列复合句。",
            "根据独立从句数量判断句型，而不是根据句长判断。",
            "为不同句型选择正确的连接方式。",
        ],
        "steps": [
            "数清句中有几个独立从句。",
            "再检查是否含有从属从句。",
            "用“独立从句数量 + 从属从句数量”确定句型。",
        ],
        "traps": [
            "把含并列谓语的简单句误判为并列句。",
            "看到多个动词就误以为有多个独立从句。",
            "忽略从属连词对从句独立性的影响。",
        ],
    },
    "joining-independent-clauses": {
        "goals": [
            "掌握连接两个独立从句的四种标准方式。",
            "区分分号、句号、逗号加并列连词和从属连接。",
            "依据句法关系而不是停顿感选择标点。",
        ],
        "steps": [
            "先确认标点两侧是否都能独立成句。",
            "若两侧都是独立从句，可用句号、分号或“逗号 + FANBOYS”。",
            "若使用从属连词，确认它只把其中一部分变为从属从句。",
        ],
        "traps": [
            "只用逗号连接两个独立从句，形成 comma splice。",
            "在分号后再加 and 或 but。",
            "把 however 等连接副词当作 FANBOYS 直接接在逗号后。",
        ],
    },
    "sentence-boundary-errors": {
        "goals": [
            "识别粘连句、逗号拼接和句子残缺。",
            "用独立从句数量定位句子边界。",
            "选择改变最少且语法完整的修正方式。",
        ],
        "steps": [
            "逐个标出独立从句的起点和终点。",
            "两个独立从句之间若没有合格连接，就是粘连句或逗号拼接。",
            "若某一部分不能独立表达完整意思，检查它是否应并入相邻句。",
        ],
        "traps": [
            "认为逗号足以连接两个完整句。",
            "看到句号就默认前后都完整。",
            "修复边界时无意改变原句逻辑关系。",
        ],
    },
    "dependent-and-main-clauses": {
        "goals": [
            "识别从属连词、关系词和主从句边界。",
            "判断从属从句在句中的语法功能。",
            "正确处理句首从属从句后的逗号。",
        ],
        "steps": [
            "先圈出 because、although、when、if、who、which、that 等引导词。",
            "找到它引导的主谓结构并确定从句终点。",
            "确认全句另有一个可以独立成立的主句。",
        ],
        "traps": [
            "把 because 或 although 引导的部分单独成句。",
            "忽略关系从句中的谓语，导致主谓判断错误。",
            "从句在前时漏掉与主句之间的逗号。",
        ],
    },
    "colons": {
        "goals": [
            "掌握冒号前必须完整、冒号后负责说明的核心规则。",
            "识别冒号后的解释、列举、定义或强调。",
            "区分冒号与破折号、分号的功能。",
        ],
        "steps": [
            "遮住冒号后的内容，检查前面能否独立成句。",
            "再读冒号后内容，确认它具体说明前面的哪一部分。",
            "若前面以 such as、including 或介词结尾，通常不应再加冒号。",
        ],
        "traps": [
            "在不完整的引导语后加冒号。",
            "在 such as 或 including 后重复使用冒号。",
            "把冒号当成连接两个并列观点的分号。",
        ],
    },
    "dashes": {
        "goals": [
            "区分单个破折号的解释作用与一对破折号的插入作用。",
            "使用删除测试判断插入内容是否为非必要信息。",
            "在破折号、逗号和冒号之间作出有依据的选择。",
        ],
        "steps": [
            "先数破折号：单个通常引出句末解释；一对通常包住插入信息。",
            "遇到成对破折号时删除中间内容，检查剩余主句是否完整。",
            "若是句末解释，再检查破折号前是否已构成完整主句。",
            "最后检查开、闭标点是否同类，不能一边破折号、一边逗号。",
        ],
        "traps": [
            "把连字符（-）和破折号（—）的排版形式当成不同语法规则；本讲义用短横线代替破折号。",
            "用一个破折号开启句中插入语，却没有用第二个破折号闭合。",
            "混用破折号和逗号包围同一段插入信息。",
            "只凭语气强弱选择破折号，不检查标点两侧的句子结构。",
        ],
    },
    "commas": {
        "goals": [
            "掌握句首成分、非必要信息和连接结构中的逗号。",
            "用删除测试区分必要与非必要信息。",
            "避免把所有停顿都写成逗号。",
        ],
        "steps": [
            "先判断逗号附近是句首短语、插入信息还是两个从句的边界。",
            "删除成对逗号之间的内容，检查主句是否仍完整且核心指代不变。",
            "若逗号连接两个独立从句，确认后面紧跟 FANBOYS。",
        ],
        "traps": [
            "必要关系从句前误加逗号。",
            "只用一个逗号包围句中插入语。",
            "仅凭朗读停顿添加逗号。",
        ],
    },
    "comma-restrictions": {
        "goals": [
            "识别主谓、动宾、介词与宾语之间不能插入的逗号。",
            "判断逗号是否真正标记了一个语法边界。",
            "删除不承担功能的多余逗号。",
        ],
        "steps": [
            "先读逗号左右紧邻的词，判断它们是否属于同一基本结构。",
            "若逗号拆开主语与谓语、动词与宾语或介词与宾语，优先删除。",
            "只有存在句首成分、插入语、并列项或合法从句连接时才保留。",
        ],
        "traps": [
            "长主语之后凭感觉加逗号。",
            "在 that 与其引导的从句之间加逗号。",
            "在 such as 后无条件加冒号或逗号。",
        ],
    },
    "subject-verb-agreement": {
        "goals": [
            "找到真正主语并判断其单复数。",
            "排除介词短语、插入语和倒装结构的干扰。",
            "处理集合名词、不定代词和并列主语。",
        ],
        "steps": [
            "圈出带时态的谓语，再向前追问“谁或什么执行动作”。",
            "划掉主语与谓语之间的介词短语和插入成分。",
            "根据核心主语而不是离谓语最近的名词选择单复数。",
        ],
        "traps": [
            "让介词短语中的复数名词干扰单数主语。",
            "在 there be 结构中把 there 当主语。",
            "忽略 each、every、either、neither 通常按单数处理。",
        ],
    },
    "finite-and-nonfinite-verbs": {
        "goals": [
            "区分限定动词与不定式、动名词和分词。",
            "保证每个独立从句有且只有合适的谓语中心。",
            "根据句法位置选择非谓语形式。",
        ],
        "steps": [
            "标出所有动词形式，并找出带时态、情态或主谓一致变化的限定动词。",
            "确认每个从句需要一个谓语，但不能堆叠两个未连接的限定动词。",
            "其余动作根据功能改为 to do、doing 或 done。",
        ],
        "traps": [
            "把 -ing 形式单独当作完整谓语。",
            "一个主语后连续放两个限定动词却没有连接词。",
            "只按中文意思选择动词形式，不看句法位置。",
        ],
    },
    "verb-tense": {
        "goals": [
            "根据明确时间标志和上下文时间线选择时态。",
            "区分一般、完成和进行所表达的时间关系。",
            "保持同一叙述中的时态逻辑一致。",
        ],
        "steps": [
            "圈出时间词、日期和相邻句中的时态线索。",
            "把事件放到时间线上，判断先后、持续或已完成关系。",
            "只有时间关系发生变化时才改变时态。",
        ],
        "traps": [
            "为了形式多样而无理由切换时态。",
            "看到 since 就机械选择某个时态而不看主句时间。",
            "忽略过去完成时必须表达“过去中的更早”。",
        ],
    },
    "pronouns": {
        "goals": [
            "确保代词与先行词在人称和数上保持一致。",
            "判断主格、宾格和反身代词的句法位置。",
            "消除含糊或不存在的指代。",
        ],
        "steps": [
            "为每个代词写出它具体指代的名词。",
            "检查先行词是否唯一、清楚，并与代词单复数一致。",
            "根据代词在从句中的主语或宾语位置选择格。",
        ],
        "traps": [
            "用单数代词指代复数先行词，或反之。",
            "在两个可能先行词之间留下含糊指代。",
            "为了显得正式而滥用 myself、themselves 等反身代词。",
        ],
    },
    "possessives-and-plurals": {
        "goals": [
            "区分普通复数、单数所有格和复数所有格。",
            "根据拥有者数量决定撇号位置。",
            "掌握 its/it's、their/they're 等高频区别。",
        ],
        "steps": [
            "先判断句意是“多个”还是“属于”。",
            "若表示所属，找出拥有者是单数还是以 s 结尾的复数。",
            "把缩写还原成完整形式，验证 it's、they're 等是否成立。",
        ],
        "traps": [
            "给普通复数随意加撇号。",
            "混淆 its 与 it's。",
            "只看被拥有的东西数量，不看拥有者数量。",
        ],
    },
    "modifiers": {
        "goals": [
            "让修饰语紧邻它真正修饰的对象。",
            "识别悬垂修饰和错位修饰。",
            "通过改写主语修复逻辑不成立的修饰关系。",
        ],
        "steps": [
            "圈出句首或句中的修饰短语。",
            "追问紧跟其后的名词是否能合理执行该动作或具有该特征。",
            "若不能，移动修饰语或改写主句主语。",
        ],
        "traps": [
            "句首分词短语后接形式主语 it 或无关名词。",
            "修饰语离目标太远，产生多种解释。",
            "只检查语法形式，不检查逻辑上的动作执行者。",
        ],
    },
    "restrictive-information": {
        "goals": [
            "区分决定身份的必要信息与可删除的补充信息。",
            "正确使用逗号、破折号或括号包围非限制信息。",
            "根据指代是否仍清楚应用删除测试。",
        ],
        "steps": [
            "删除关系从句或同位语，观察所指对象是否仍唯一清楚。",
            "若身份或范围改变，信息必要，不用成对标点。",
            "若核心指代和主句都不变，使用一对匹配的插入标点。",
        ],
        "traps": [
            "把所有 who/which 从句都用逗号隔开。",
            "只看句子能否读通，不看删除后指代范围是否改变。",
            "插入语只标一侧，造成标点不配对。",
        ],
    },
    "parallel-structure": {
        "goals": [
            "让并列项目保持相同词性和结构。",
            "识别相关连词两侧必须平行。",
            "在比较、列表和动作序列中保持一致。",
        ],
        "steps": [
            "圈出 and、or、but、not only...but also 等连接词。",
            "比较连接词两侧成分的语法标签和层级。",
            "选择能让所有并列项采用同一结构的改写。",
        ],
        "traps": [
            "并列名词、动名词和完整从句。",
            "只让最后两个列表项平行，忽略第一项。",
            "not only 与 but also 两侧起点不一致。",
        ],
    },
    "comparisons": {
        "goals": [
            "确保比较双方属于同一类别。",
            "补足必要的替代词，避免拿人和物直接比较。",
            "区分比较级、最高级及比较范围。",
        ],
        "steps": [
            "圈出 than、as...as、like、unlike 等比较信号。",
            "写出比较符号两侧真正被比较的对象。",
            "检查两者是否同类、结构平行且比较范围合理。",
        ],
        "traps": [
            "把某人的作品与另一个人直接比较。",
            "比较级用于三者以上却没有合适语境。",
            "省略 that/those 后造成比较对象类别不同。",
        ],
    },
    "adjectives-and-adverbs": {
        "goals": [
            "根据被修饰对象选择形容词或副词。",
            "识别感官、状态等系动词后的表语形容词。",
            "避免把形式相似的词性混用。",
        ],
        "steps": [
            "先找待修饰的中心词。",
            "修饰名词用形容词；修饰动词、形容词或整句通常用副词。",
            "若动词表示状态或感受，检查后面是否需要形容词作表语。",
        ],
        "traps": [
            "看到动词就机械使用副词，忽略系动词。",
            "混淆 hard/hardly、late/lately 等意义不同的形式。",
            "只靠 -ly 词尾判断词性。",
        ],
    },
    "count-and-noncount-nouns": {
        "goals": [
            "区分可数名词与不可数名词。",
            "正确搭配 many/few 与 much/little。",
            "根据名词类型选择冠词和单复数。",
        ],
        "steps": [
            "判断名词能否直接用数字逐个计数。",
            "检查限定词与名词类型是否匹配。",
            "需要计量不可数名词时使用 a piece of、an amount of 等单位结构。",
        ],
        "traps": [
            "给 information、advice、research 等不可数名词直接加复数。",
            "混用 fewer 与 less。",
            "不可数名词前误用 a/an。",
        ],
    },
    "articles": {
        "goals": [
            "根据是否特指选择 a/an、the 或零冠词。",
            "依据发音而不是拼写选择 a 或 an。",
            "掌握单数可数名词通常需要限定词的原则。",
        ],
        "steps": [
            "先判断名词是否为单数可数名词。",
            "若首次泛指同类中的一个，用 a/an；若双方已知或唯一，用 the。",
            "若泛指复数或不可数概念，检查是否应使用零冠词。",
        ],
        "traps": [
            "按首字母而不是首音选择 a/an。",
            "单数可数名词裸用。",
            "把所有抽象名词都无条件加 the。",
        ],
    },
    "transitions": {
        "goals": [
            "先判断句间逻辑，再选择连接词。",
            "区分转折、因果、递进、举例和顺序关系。",
            "同时检查连接副词周围的句子边界。",
        ],
        "steps": [
            "遮住选项，只读前后句并用中文概括关系。",
            "把关系归入同向、反向、因果、举例或顺序。",
            "选词后代回原文，再检查标点与逻辑语气。",
        ],
        "traps": [
            "因为连接词意思熟悉就直接选择。",
            "只看前一句，不读后一句的立场。",
            "逻辑正确却忽略 however 等连接副词不能只靠逗号连接完整句。",
        ],
    },
    "sat-grammar-traps": {
        "goals": [
            "集中识别 SAT 最常见的结构性诱导项。",
            "把长句还原为主干后再判断。",
            "用可验证规则替代语感。",
        ],
        "steps": [
            "先判断题目考句子边界、动词、修饰还是逻辑。",
            "删除介词短语和插入语，保留主干。",
            "逐项说明错误原因，只保留同时满足语法和语意的选项。",
        ],
        "traps": [
            "选择更长、更正式但结构错误的表达。",
            "被离谓语最近的名词或离修饰语最近的错误对象干扰。",
            "把“读起来顺”当作充分证据。",
        ],
    },
    "sat-grammar-workflow": {
        "goals": [
            "建立从结构、规则到语意的固定做题顺序。",
            "快速识别题型并调用对应检查方法。",
            "在有限时间内完成复核。",
        ],
        "steps": [
            "第一遍只看划线处附近，判断考点类型。",
            "第二遍拆主干，标出主语、限定动词和从句边界。",
            "第三遍应用对应规则并比较选项差异。",
            "最后通读全句，确认语意、逻辑和简洁性。",
        ],
        "traps": [
            "一开始就逐字翻译整句，浪费时间。",
            "同时比较四个选项却没有先确定考点。",
            "语法检查结束后不再通读，漏掉逻辑问题。",
        ],
    },
    "essential-formulas": {
        "goals": [
            "记住句子边界、插入信息和一致性的核心公式。",
            "把公式转化为可执行检查动作。",
            "根据题型快速调用正确规则。",
        ],
        "steps": [
            "先识别公式中的结构变量，如 IC、DC、主语和谓语。",
            "把原句替换成结构符号，忽略暂时无关的词义细节。",
            "应用公式后再还原原句，检查意思是否保持。",
        ],
        "traps": [
            "背下标点形式却不确认 IC 是否真的完整。",
            "把公式机械套用到必要信息或特殊语境。",
            "只记结论，不会在原句中定位对应成分。",
        ],
    },
    "study-priorities": {
        "goals": [
            "按高频程度安排语法复习顺序。",
            "把错题归因到具体规则而不是笼统粗心。",
            "形成可循环复盘的个人清单。",
        ],
        "steps": [
            "先巩固句子边界、动词和标点三类高频基础。",
            "每道错题记录考点、误判原因和一条可执行检查动作。",
            "定期混合复习，并优先重做重复出错的规则。",
        ],
        "traps": [
            "平均分配时间，忽略自己的高频错误。",
            "只看答案解释而不重新拆句。",
            "大量刷题却不记录错误模式。",
        ],
    },
}

SECTION_GUIDES: dict[tuple[str, str], list[str]] = {
    (
        "dashes",
        "一个破折号：引出解释或强调",
    ): [
        "规则：单个破折号通常出现在句末，引出对前面完整意思的解释、结果、列举或强调。",
        "例句拆解：The student made one mistake 已经是完整主句；he forgot his name 具体说明 mistake 的内容。",
        "SAT 判断：先遮住破折号后的内容。若前面不能独立成句，就不能仅凭停顿使用这种句末破折号。",
        "与冒号比较：两者都可引出解释；破折号语气更突然、更强调，但在 SAT 中首先仍要检查前面是否完整。",
    ],
    (
        "dashes",
        "两个破折号：插入补充信息",
    ): [
        "规则：一对破折号把非必要的补充信息嵌入主句，开、闭两个破折号共同标出插入范围。",
        "删除测试：去掉 who was very tired 后，The student made a mistake 仍有主语、谓语和完整意思，因此中间内容可以作为插入语。",
        "语气差别：成对逗号也能完成相同的语法工作；破折号通常让补充信息更醒目，括号则更弱化。",
        "SAT 判断：先找主句被打断的位置，再找主句恢复的位置；这两个边界必须使用同类标点。",
    ],
    (
        "dashes",
        "插入标点必须成对",
    ): [
        "错误原因：第一个破折号开启了插入语，逗号却不能替它闭合；同一段插入信息不能用两种标点配对。",
        "正确方案一：用“破折号 + 破折号”突出补充信息；正确方案二：用“逗号 + 逗号”平稳地补充说明。",
        "检查顺序：定位插入语起点 → 定位终点 → 删除插入语检查主句 → 核对两侧标点是否匹配。",
        "边界例外：如果补充信息一直延伸到句末，只需要在它开始前使用一个破折号，句末由句号或其他终止标点收尾。",
    ],
}

SPARSE_SECTION_METHODS = {
    1: "先标出主语和限定动词，再确认这一结构能否独立成句。",
    2: "先判断标点两侧各有几个独立从句，再确认标点承担连接、解释还是插入功能。",
    3: "先找到真正主语和带时态的谓语，再检查单复数或时间线。",
    4: "先确定被修饰、被指代或被比较的对象，再删除插入信息复核主干。",
    5: "先概括前后逻辑并识别题型，再按固定流程排除只凭语感成立的选项。",
}


def clean_pages(source: Path) -> list[str]:
    document = fitz.open(source)
    pages: list[str] = []
    for page_number, page in enumerate(document, 1):
        lines = [line.strip() for line in page.get_text("text").splitlines()]
        cleaned: list[str] = []
        bullet_pending = False
        for line in lines:
            if not line or line == str(page_number):
                continue
            if line.startswith("SAT 语法知识点大全 · 3000 词汇量版"):
                continue
            if line == "\uf0b7":
                bullet_pending = True
                continue
            if bullet_pending:
                line = f"• {line}"
                bullet_pending = False
            cleaned.append(line)
        pages.append("\n".join(cleaned))
    return pages


def joined_text(pages: list[str]) -> str:
    text = "\n".join(pages[2:])
    replacements = {
        "Mia thought \nthe movie was boring.": "Mia thought the movie was boring.",
        "单复数和所有\n格 →": "单复数和所有格 →",
        "大多\n数 SAT": "大多数 SAT",
    }
    for before, after in replacements.items():
        text = text.replace(before, after)
    return text


def split_chapters(text: str) -> list[tuple[str, list[str]]]:
    heading = re.compile(r"(?m)^第[\u4e00-\u9fa5]+部分：\s*(.+)$")
    matches = list(heading.finditer(text))
    if len(matches) != len(CHAPTERS):
        raise ValueError(f"期望 27 章，实际解析到 {len(matches)} 章")
    chapters: list[tuple[str, list[str]]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        lines = [
            line.strip()
            for line in text[match.end() : end].splitlines()
            if line.strip()
        ]
        chapters.append((match.group(1).strip(), lines))
    return chapters


def section_heading(line: str) -> str | None:
    numbered = re.match(r"^[一二三四五六七八九十百]+、\s*(.+)$", line)
    if numbered:
        return numbered.group(1).strip()
    labeled = re.match(
        r"^(?:陷阱[一二三四五六七八九十]|第[一二三四五六七八九十]+步|第[一二三四五六七八九十]+阶段)：\s*(.+)$",
        line,
    )
    if labeled:
        return line
    if line in SPECIAL_HEADINGS:
        return line
    return None


def build_sections(lines: list[str]) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    current = {"title": "本章要点", "lines": []}
    for line in lines:
        heading = section_heading(line)
        if heading:
            if current["lines"]:
                sections.append(current)
            current = {"title": heading, "lines": []}
        else:
            current["lines"].append(line)
    if current["lines"]:
        sections.append(current)
    return sections


def enrich_sections(
    topic_id: str,
    module_sequence: int,
    sections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Add authored explanations where the source PDF only supplies examples."""
    guide = CHAPTER_GUIDES[topic_id]
    enriched: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        details = SECTION_GUIDES.get((topic_id, section["title"]), [])
        source_notes = [
            line
            for line in section["lines"]
            if not looks_english(line)
            and not line.startswith(("• ", "错误：", "正确："))
        ]
        if not details and not source_notes:
            details = [
                f"这一节在考什么：{guide['goals'][index % len(guide['goals'])]}",
                f"判断方法：{SPARSE_SECTION_METHODS[module_sequence]}",
            ]
        enriched.append({**section, "details": details})
    return enriched


def display_line(line: str) -> str:
    return re.sub(r"^(?:错误|正确|不清楚|清楚|更清楚|简化)：\s*", "", line).strip()


def looks_english(line: str) -> bool:
    value = display_line(line)
    latin = len(re.findall(r"[A-Za-z]", value))
    chinese = len(re.findall(r"[\u3400-\u9fff]", value))
    return latin >= 3 and (value[:1].isascii() or latin > chinese * 1.5)


def build_examples(sections: list[dict[str, Any]]) -> list[dict[str, str]]:
    examples: list[dict[str, str]] = []
    seen: set[str] = set()
    for section in sections:
        lines = section["lines"]
        for index, line in enumerate(lines):
            if line.startswith(("错误：", "不清楚：")) or not looks_english(line):
                continue
            english = display_line(line)
            if english in seen:
                continue
            note = ""
            if index + 1 < len(lines) and not looks_english(lines[index + 1]):
                note = lines[index + 1]
            examples.append(
                {"english": english, "chinese": "", "note": note or section["title"]}
            )
            seen.add(english)
    return examples


def build_mistakes(sections: list[dict[str, Any]]) -> list[dict[str, str]]:
    mistakes: list[dict[str, str]] = []
    seen: set[str] = set()
    for section in sections:
        lines = section["lines"]
        for index, line in enumerate(lines):
            if not line.startswith(("错误：", "不清楚：")):
                continue
            wrong = display_line(line)
            right = ""
            explanation = section["title"]
            for candidate in lines[index + 1 : index + 4]:
                if candidate.startswith(("正确：", "清楚：", "更清楚：", "简化：")):
                    right = display_line(candidate)
                    continue
                if right and not looks_english(candidate):
                    explanation = candidate
                    break
            if right and wrong not in seen:
                mistakes.append(
                    {"wrong": wrong, "right": right, "explanation": explanation}
                )
                seen.add(wrong)
    return mistakes


def first_summary_line(sections: list[dict[str, Any]], fallback: str) -> str:
    for section in sections:
        for line in section["lines"]:
            if not looks_english(line) and not line.startswith("• "):
                return line
    return fallback


def build_library(source: Path) -> dict[str, Any]:
    pages = clean_pages(source)
    chapters = split_chapters(joined_text(pages))
    topics: list[dict[str, Any]] = []
    for index, ((title, lines), definition) in enumerate(
        zip(chapters, CHAPTERS, strict=True), 1
    ):
        topic_id, english, module_sequence, page_range = definition
        sections = build_sections(lines)
        sections = enrich_sections(topic_id, module_sequence, sections)
        summary = first_summary_line(sections, f"学习{title}的 SAT 核心用法。")
        rules = [
            f"{section['title']}：{section['lines'][0]}"
            for section in sections
            if section["lines"]
        ]
        source_ref = {"level": "SAT 3000词汇量版", "rangeLabel": f"第 {page_range} 页"}
        topics.append(
            {
                "id": topic_id,
                "sequence": sum(
                    1 for topic in topics if topic["moduleSequence"] == module_sequence
                )
                + 1,
                "globalSequence": index,
                "moduleSequence": module_sequence,
                "title": title,
                "english": english,
                "overview": summary,
                "patterns": [],
                "levels": [
                    {
                        "id": "beginner",
                        "label": "SAT核心",
                        "focus": title,
                        "sequence": 1,
                        "content": rules,
                        "source": source_ref,
                    }
                ],
                "examples": build_examples(sections),
                "mistakes": build_mistakes(sections),
                "sections": sections,
                "guide": CHAPTER_GUIDES[topic_id],
                "related": [],
                "sources": [source_ref],
            }
        )

    parts: list[dict[str, Any]] = []
    for sequence, (module_id, title, english, summary) in enumerate(MODULES, 1):
        module_topics: list[dict[str, Any]] = []
        for topic in topics:
            if topic["moduleSequence"] != sequence:
                continue
            topic = {
                key: value for key, value in topic.items() if key != "moduleSequence"
            }
            module_topics.append(topic)
        parts.append(
            {
                "id": module_id,
                "sequence": sequence,
                "title": title,
                "english": english,
                "summary": summary,
                "topics": module_topics,
            }
        )

    return {
        "version": "sat-grammar-3000-v2",
        "generatedAt": None,
        "title": "SAT 语法知识点大全",
        "description": "基于《SAT 语法知识点大全 - 3000 词汇量版》的 27 章精讲课程，包含目标、判断步骤、例句分析与高频陷阱。",
        "summary": {
            "partCount": len(parts),
            "topicCount": len(topics),
            "levelLessonCount": len(topics),
            "sourceUnitCount": len(topics),
        },
        "sources": [
            {
                "id": "sat-grammar-3000",
                "level": "SAT 3000词汇量版",
                "fileName": source.name,
                "unitCount": len(topics),
            }
        ],
        "parts": parts,
        "sourceMappings": [
            {"book": "sat-grammar-3000", "unit": index, "topicId": topic[0]}
            for index, topic in enumerate(CHAPTERS, 1)
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    library = build_library(args.source.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(library, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Built {library['summary']['topicCount']} SAT grammar chapters "
        f"across {library['summary']['partCount']} modules."
    )


if __name__ == "__main__":
    main()
