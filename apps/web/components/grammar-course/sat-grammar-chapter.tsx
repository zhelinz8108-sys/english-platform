'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, Compass, X } from 'lucide-react';
import type { SatGrammarEntry, SatGrammarTable } from '@/lib/sat-grammar';
import { grammarBasePath } from './grammar-api';
import styles from './sat-grammar.module.css';

function ReferenceTable({ table }: { table: SatGrammarTable }) {
  if (!table.rows.length && table.headers.length === 2) {
    return (
      <div className={styles.sourceIndex}>
        <strong>{table.headers[0]}</strong>
        <span>{table.headers[1]}</span>
      </div>
    );
  }

  return (
    <div className={styles.tableScroller}>
      <table>
        <thead>
          <tr>
            {table.headers.map((header, index) => (
              <th key={`${header}:${index}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${cell}:${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SatGrammarChapter({
  entry,
  previous,
  next,
}: {
  entry: SatGrammarEntry;
  previous: Pick<SatGrammarEntry, 'id' | 'label' | 'title'> | null;
  next: Pick<SatGrammarEntry, 'id' | 'label' | 'title'> | null;
}) {
  const pathname = usePathname();
  const grammarBase = grammarBasePath(pathname);
  const courseBase = `${grammarBase}/sat`;
  const ruleCount = entry.sections.reduce((sum, section) => sum + section.rules.length, 0);

  return (
    <div className={styles.page}>
      <nav aria-label="面包屑" className={styles.breadcrumb}>
        <Link href={grammarBase}>语法</Link>
        <ChevronRight size={13} />
        <Link href={courseBase}>SAT语法</Link>
        <ChevronRight size={13} />
        <span>{entry.label}</span>
      </nav>

      <header className={styles.chapterHeader}>
        <p className={styles.eyebrow}>
          {entry.kind === 'chapter' ? 'SAT Grammar Chapter' : 'SAT Grammar Reference'}
        </p>
        <h1>
          {entry.label} {entry.title}
        </h1>
        {entry.intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <span>
          {ruleCount ? `${ruleCount} 个规则知识点` : `${entry.sections.length} 个速查部分`}
        </span>
      </header>

      <nav aria-label="本页目录" className={styles.pageToc}>
        <strong>本页目录</strong>
        <ol>
          {entry.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <article className={styles.chapterContent}>
        {entry.sections.map((section) => (
          <section className={styles.chapterSection} id={section.id} key={section.id}>
            <header className={styles.chapterSectionHeader}>
              <span>{String(section.sequence).padStart(2, '0')}</span>
              <h2>{section.title}</h2>
            </header>

            {section.notes.map((note) => (
              <p className={styles.sectionNote} key={note}>
                {note}
              </p>
            ))}

            {section.lists.map((list, listIndex) => {
              const List = list.ordered ? 'ol' : 'ul';
              return (
                <List className={styles.referenceList} key={listIndex}>
                  {list.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </List>
              );
            })}

            {section.tables.map((table, tableIndex) => (
              <ReferenceTable key={tableIndex} table={table} />
            ))}

            <div className={styles.ruleStack}>
              {section.rules.map((rule) => (
                <section className={styles.ruleCard} id={rule.id} key={rule.id}>
                  <header className={styles.ruleHeader}>
                    <span>{String(rule.sequence).padStart(3, '0')}</span>
                    <h3>{rule.title}</h3>
                  </header>

                  <div className={styles.explanationBlock}>
                    <strong>核心规则</strong>
                    <p>{rule.core}</p>
                  </div>

                  <div className={styles.explanationBlock}>
                    <span className={styles.explanationIcon}>
                      <Compass aria-hidden size={15} />
                    </span>
                    <strong>判断方法</strong>
                    <p>{rule.method}</p>
                  </div>

                  {rule.examples.map((example, exampleIndex) => (
                    <div className={styles.examplePair} key={exampleIndex}>
                      <div className={styles.correctExample}>
                        <span>
                          <Check aria-hidden size={14} />
                          正确例句
                        </span>
                        <p>{example.correct}</p>
                      </div>
                      <div className={styles.incorrectExample}>
                        <span>
                          <X aria-hidden size={14} />
                          错误例句
                        </span>
                        <p>{example.incorrect}</p>
                      </div>
                    </div>
                  ))}

                  {rule.trap ? (
                    <div className={styles.trapNote}>
                      <CircleAlert aria-hidden size={16} />
                      <p>
                        <strong>常见陷阱：</strong>
                        {rule.trap}
                      </p>
                    </div>
                  ) : null}

                  {rule.notes.map((note) => (
                    <p className={styles.sectionNote} key={note}>
                      {note}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          </section>
        ))}
      </article>

      <p className={styles.sourceNote}>内容依据：《SAT语法知识点全整理》。</p>

      <nav aria-label="章节翻页" className={styles.chapterNavigation}>
        {previous ? (
          <Link href={`${courseBase}/${previous.id}`}>
            <ArrowLeft aria-hidden size={15} />
            <span>
              <small>上一页 · {previous.label}</small>
              <strong>{previous.title}</strong>
            </span>
          </Link>
        ) : (
          <Link href={courseBase}>
            <ArrowLeft aria-hidden size={15} />
            <span>
              <small>返回</small>
              <strong>知识点目录</strong>
            </span>
          </Link>
        )}
        {next ? (
          <Link href={`${courseBase}/${next.id}`}>
            <span>
              <small>下一页 · {next.label}</small>
              <strong>{next.title}</strong>
            </span>
            <ArrowRight aria-hidden size={15} />
          </Link>
        ) : (
          <Link href={courseBase}>
            <span>
              <small>完成</small>
              <strong>返回知识点目录</strong>
            </span>
            <ArrowRight aria-hidden size={15} />
          </Link>
        )}
      </nav>
    </div>
  );
}
