'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  FlaskConical,
  Layers3,
  LibraryBig,
  Search,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui';
import type { VocabularyBook, VocabularyBookCatalog } from '@/data/vocabulary-library';
import styles from './vocabulary-library.module.css';

const RECENT_BOOK_KEY = 'aurelis:vocabulary-books:recent:v1';

const bookLabels: Record<string, string> = {
  'toefl-sentences': '托福',
  'gre-random': 'GRE',
  'situational-15000': '分类词汇',
};

function learningUnitCount(book: VocabularyBook) {
  return book.sections.reduce((total, section) => total + section.items.length, 0);
}

function matchesBook(book: VocabularyBook, normalizedQuery: string) {
  if (!normalizedQuery) return true;
  const metadata = [
    book.title,
    book.shortTitle,
    book.author,
    book.description,
    book.scale,
    book.category,
    ...book.features,
  ]
    .join(' ')
    .toLocaleLowerCase('zh-CN');
  return (
    metadata.includes(normalizedQuery) ||
    book.sections.some(
      (section) =>
        [section.title, section.label ?? '']
          .join(' ')
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedQuery) ||
        section.items.some((item) =>
          [item.title, item.label ?? '']
            .join(' ')
            .toLocaleLowerCase('zh-CN')
            .includes(normalizedQuery),
        ),
    )
  );
}

export function VocabularyLibrary({ catalog }: { catalog: VocabularyBookCatalog }) {
  const pathname = usePathname();
  const vocabularyBase = pathname.startsWith('/student/')
    ? '/student/learning/english/vocabulary'
    : '/learning/english/vocabulary';
  const [query, setQuery] = useState('');
  const [recentBookId, setRecentBookId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');

  useEffect(() => {
    setRecentBookId(window.localStorage.getItem(RECENT_BOOK_KEY));
    setHydrated(true);
  }, []);

  const filteredBooks = useMemo(
    () => catalog.books.filter((book) => matchesBook(book, normalizedQuery)),
    [catalog.books, normalizedQuery],
  );
  const recentBook =
    (hydrated && catalog.books.find((book) => book.id === recentBookId)) || catalog.books[0];

  function rememberBook(bookId: string) {
    setRecentBookId(bookId);
    window.localStorage.setItem(RECENT_BOOK_KEY, bookId);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        actions={
          <Link className={styles.assessmentLink} href={vocabularyBase + '/assessment'}>
            <Target size={17} /> 词汇量测评
          </Link>
        }
        description="本地单词书已识别为网页文字，按 Sentence、Word List 和场景目录学习。"
        eyebrow="英语 · 词汇"
        title="词汇书架"
      />

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.heroIcon}>
            <LibraryBig size={27} />
          </span>
          <div>
            <p className={styles.kicker}>YOUR LOCAL VOCABULARY SHELF</p>
            <h2>三本词汇书，全部转换成可读的网页文字。</h2>
            <p>
              保留音标、释义、搭配和例句层级；全库相同词条只保留第一次出现，后续重复内容已移除。
            </p>
          </div>
        </div>
        {recentBook ? (
          <Link
            className={styles.primaryButton}
            href={vocabularyBase + '/books/' + recentBook.id}
            onClick={() => rememberBook(recentBook.id)}
          >
            {recentBookId ? '继续阅读' : '打开第一本'} <ArrowRight size={18} />
          </Link>
        ) : null}
      </section>

      <section className={styles.stats} aria-label="本地词汇书统计">
        <div>
          <LibraryBig size={20} />
          <span>原版词书</span>
          <strong>{catalog.summary.bookCount}</strong>
        </div>
        <div>
          <Layers3 size={20} />
          <span>学习单元</span>
          <strong>{catalog.summary.learningUnitCount}</strong>
        </div>
        <div>
          <FileText size={20} />
          <span>唯一词条</span>
          <strong>{catalog.summary.uniqueWordEntryCount.toLocaleString('en-US')}</strong>
        </div>
        <div>
          <ShieldCheck size={20} />
          <span>已删重复</span>
          <strong>{catalog.summary.duplicateEntryCount.toLocaleString('en-US')}</strong>
        </div>
      </section>

      <section className={styles.catalog}>
        <div className={styles.catalogHeader}>
          <div>
            <p className={styles.kicker}>SOURCE BOOKS</p>
            <h2>选择一本词汇书</h2>
          </div>
          <label className={styles.searchBox}>
            <Search size={17} />
            <span className="sr-only">搜索词书或目录</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索书名、考试或场景目录"
              type="search"
              value={query}
            />
          </label>
        </div>

        {filteredBooks.length ? (
          <div className={styles.bookGrid}>
            {filteredBooks.map((book) => {
              const unitCount = learningUnitCount(book);
              return (
                <article className={styles.bookCard} key={book.id}>
                  <div className={styles.bookCopy}>
                    <div className={styles.bookTopline}>
                      <span>{bookLabels[book.id] ?? book.category}</span>
                      <small>{book.extractionMethod === 'ocr' ? 'OCR 识别文字' : '网页文字'}</small>
                    </div>
                    <h3>{book.shortTitle}</h3>
                    <p className={styles.fullTitle}>{book.title}</p>
                    <p className={styles.description}>{book.description}</p>
                    <div className={styles.featureRow}>
                      {book.features.map((feature) => (
                        <span key={feature}>{feature}</span>
                      ))}
                    </div>
                    <div className={styles.bookScale}>
                      <BookOpenCheck size={17} />
                      <span>
                        <strong>{unitCount}</strong> 个单元 ·{' '}
                        {book.wordEntryCount.toLocaleString('zh-CN')} 个保留词条
                      </span>
                      <small>
                        {book.scale} · 去除 {book.duplicateEntryCount.toLocaleString('zh-CN')}{' '}
                        个后续重复
                      </small>
                    </div>
                    <div className={styles.bookActions}>
                      <Link
                        className={styles.readButton}
                        data-testid={'read-' + book.id}
                        href={vocabularyBase + '/books/' + book.id}
                        onClick={() => rememberBook(book.id)}
                      >
                        立即阅读 <ArrowRight size={17} />
                      </Link>
                      {book.id === 'toefl-sentences' ? (
                        <Link
                          className={styles.checkButton}
                          data-testid="check-toefl-sentences"
                          href={vocabularyBase + '/books/' + book.id + '/check'}
                        >
                          <ClipboardCheck size={16} /> 词汇检测
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Search size={25} />
            <h3>没有找到匹配的词书或目录</h3>
            <p>可以搜索 TOEFL、GRE、场景名称或具体章节。</p>
            <button onClick={() => setQuery('')} type="button">
              清除搜索
            </button>
          </div>
        )}
      </section>

      <section className={styles.sourceNotice}>
        <span>
          <CheckCircle2 size={21} />
        </span>
        <div>
          <h2>只显示识别后的网页文字</h2>
          <p>原文件仍保留在 source\单词书；网站按单元读取文字 JSON，不嵌入、流式传输或公开 PDF。</p>
        </div>
      </section>

      <section className={styles.assessmentBanner}>
        <span>
          <FlaskConical size={23} />
        </span>
        <div>
          <p className={styles.kicker}>NOT SURE WHERE TO START?</p>
          <h2>先测一测，再选择合适的词书</h2>
          <p>词汇量测评会估计你的书面词义识别范围，结果仅作为学习定位参考。</p>
        </div>
        <Link href={vocabularyBase + '/assessment'}>
          开始测评 <ArrowRight size={17} />
        </Link>
      </section>
    </div>
  );
}
