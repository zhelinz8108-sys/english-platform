'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Bell,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock3,
  Crown,
  Flame,
  Headphones,
  House,
  Languages,
  LogOut,
  Menu,
  MessageCircle,
  PenLine,
  Route,
  Target,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { authApi, isDemoMode } from '@/lib/api';
import { persistTenantSelection } from '@/lib/session';
import {
  studentDashboardMock,
  type StudentNavItem,
  type StudentPlanItem,
  type StudentSkill,
  type StudentSkillProgress,
} from '@/lib/student-dashboard-mock';
import { useWorkspace } from '@/components/workspace-provider';
import styles from './student-dashboard.module.css';

const skillIcons: Record<StudentSkill, LucideIcon> = {
  reading: BookOpen,
  listening: Headphones,
  speaking: MessageCircle,
  writing: PenLine,
};

const navIcons: Record<StudentNavItem['icon'], LucideIcon> = {
  overview: House,
  path: Route,
  reading: BookOpen,
  listening: Headphones,
  speaking: MessageCircle,
  writing: PenLine,
  vocabulary: Languages,
};

function Brand() {
  return (
    <Link aria-label="Aurelis learning overview" className={styles.brand} href="/student">
      <span>Aurelis</span>
      <span className={styles.crest} aria-hidden="true">
        <span>A</span>
      </span>
    </Link>
  );
}

function DashboardSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [activeHash, setActiveHash] = useState('');
  const { quote, learner, navigation } = studentDashboardMock;

  useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash);
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, [pathname]);

  return (
    <>
      <button
        aria-label="Close navigation"
        className={`${styles.backdrop} ${open ? styles.backdropOpen : ''}`}
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label="Student navigation"
        className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}
        id="student-navigation"
      >
        <div className={styles.mobileCloseRow}>
          <Brand />
          <button
            aria-label="Close navigation"
            className={styles.iconButton}
            onClick={onClose}
            type="button"
          >
            <X size={21} />
          </button>
        </div>
        <div className={styles.desktopBrand}>
          <Brand />
        </div>

        <nav className={styles.navigation}>
          {navigation.map((item) => {
            const NavIcon = navIcons[item.icon];
            const [itemPath, itemHash = ''] = item.href.split('#');
            const expectedHash = itemHash ? `#${itemHash}` : '';
            const active = expectedHash
              ? pathname === itemPath &&
                (activeHash === expectedHash || (!activeHash && itemHash === 'reading'))
              : itemPath === '/student'
                ? pathname === itemPath
                : pathname === itemPath ||
                  (itemPath === '/student/paths' && pathname.startsWith(`${itemPath}/`));
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                href={item.href}
                key={`${item.label}-${item.href}`}
                onClick={onClose}
              >
                <NavIcon aria-hidden="true" size={20} strokeWidth={1.55} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <figure className={styles.quote}>
          <blockquote>“{quote.text}”</blockquote>
          <figcaption>— {quote.author}</figcaption>
        </figure>

        <div className={styles.membership}>
          <div>
            <Crown aria-hidden="true" size={18} strokeWidth={1.6} />
            <span>{learner.membership}</span>
          </div>
          <small>Member since {learner.memberSince}</small>
        </div>
      </aside>
    </>
  );
}

function DashboardHeader({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const { currentTenant, user } = useWorkspace();
  const [profileOpen, setProfileOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const initials = user.displayName
    .split(/\s+/u)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        setNoticeOpen(false);
      }
    }
    document.addEventListener('mousedown', closeMenus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  async function logout() {
    if (!isDemoMode()) await authApi.logout();
    persistTenantSelection(null);
    window.sessionStorage.removeItem('english-platform:demo-session');
    router.push('/login');
  }

  return (
    <header className={styles.header}>
      <button
        aria-controls="student-navigation"
        aria-label="Open navigation"
        className={`${styles.iconButton} ${styles.menuButton}`}
        onClick={onMenu}
        type="button"
      >
        <Menu size={22} />
      </button>

      <div className={styles.mobileWordmark}>Aurelis</div>

      <div className={styles.headerActions}>
        <div className={styles.noticeWrap}>
          <button
            aria-expanded={noticeOpen}
            aria-label="Notifications"
            className={styles.headerIconButton}
            onClick={() => setNoticeOpen((value) => !value)}
            type="button"
          >
            <Bell size={22} strokeWidth={1.55} />
            <span aria-hidden="true" />
          </button>
          {noticeOpen ? (
            <div className={styles.noticePopover} role="status">
              <strong>You&apos;re all caught up.</strong>
              <span>Your next lesson is ready when you are.</span>
            </div>
          ) : null}
        </div>

        <div className={styles.profileWrap} ref={profileRef}>
          <button
            aria-expanded={profileOpen}
            aria-haspopup="menu"
            aria-label="Open profile menu"
            className={styles.avatarButton}
            onClick={() => setProfileOpen((value) => !value)}
            type="button"
          >
            <span>{initials || 'AX'}</span>
          </button>
          {profileOpen ? (
            <div className={styles.profileMenu} role="menu">
              <div className={styles.profileSummary}>
                <span className={styles.profileIcon}>
                  <UserRound size={18} />
                </span>
                <div>
                  <strong>{user.displayName}</strong>
                  <span>{currentTenant.name}</span>
                </div>
              </div>
              <Link href="/student/progress" onClick={() => setProfileOpen(false)} role="menuitem">
                <BarChart3 size={17} /> Learning progress
              </Link>
              <button onClick={() => void logout()} role="menuitem" type="button">
                <LogOut size={17} /> Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function ContinueLearningCard() {
  const lesson = studentDashboardMock.continueLearning;
  return (
    <article className={styles.continueCard}>
      <div className={styles.continueContent}>
        <p className={styles.eyebrow}>{lesson.eyebrow}</p>
        <h2>
          {lesson.title.split('\n').map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h2>
        <p className={styles.lessonMeta}>
          {lesson.skill} <span aria-hidden="true">•</span> <strong>{lesson.level}</strong>
        </p>
        <div className={styles.lessonProgressRow}>
          <span className={styles.lessonProgress}>
            <span style={{ width: `${lesson.progress}%` }} />
          </span>
          <span>{lesson.progress}% complete</span>
        </div>
        <Link className={styles.goldButton} href={lesson.href}>
          Resume lesson <ChevronRight aria-hidden="true" size={17} />
        </Link>
      </div>
      <div aria-hidden="true" className={styles.architectureImage} />
    </article>
  );
}

function SkillRing({ progress, label }: { progress: number; label: string }) {
  return (
    <span
      aria-label={`${label} ${progress}%`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={progress}
      className={styles.skillRing}
      role="progressbar"
      style={{ '--skill-progress': `${progress * 3.6}deg` } as CSSProperties}
    >
      <span>{progress}%</span>
    </span>
  );
}

function SkillCard({ skill }: { skill: StudentSkillProgress }) {
  const SkillIcon = skillIcons[skill.id];
  return (
    <Link className={styles.skillCard} href={skill.href}>
      <div className={styles.skillHeading}>
        <span>
          <SkillIcon aria-hidden="true" size={19} strokeWidth={1.55} />
        </span>
        <strong>{skill.label}</strong>
      </div>
      <SkillRing label={skill.label} progress={skill.progress} />
      <small>{skill.level}</small>
    </Link>
  );
}

function TodayPlanRow({ task }: { task: StudentPlanItem }) {
  const TaskIcon = skillIcons[task.skill];
  return (
    <li className={styles.planRow}>
      <span className={styles.planIcon}>
        <TaskIcon aria-hidden="true" size={19} strokeWidth={1.55} />
      </span>
      <div className={styles.planCopy}>
        <strong>{task.title}</strong>
        <span>
          {task.description} <i aria-hidden="true">•</i> {task.detail}
        </span>
      </div>
      <span className={styles.planDuration}>{task.durationMinutes} min</span>
      <Link className={styles.planButton} href={task.href}>
        Start
      </Link>
    </li>
  );
}

function TodayPlan() {
  return (
    <section className={styles.planSection} aria-labelledby="today-plan-title">
      <div className={styles.sectionHeading}>
        <h2 id="today-plan-title">Today&apos;s Plan</h2>
        <Link href="/student/tasks">
          View full plan <ChevronRight size={15} />
        </Link>
      </div>
      <ul className={styles.planList}>
        {studentDashboardMock.todayPlan.map((task) => (
          <TodayPlanRow key={task.id} task={task} />
        ))}
      </ul>
    </section>
  );
}

function WeeklyProgressPanel() {
  const periods = studentDashboardMock.weeklyPeriods;
  const [periodId, setPeriodId] = useState<(typeof periods)[number]['id']>('this-week');
  const period = useMemo(
    () => periods.find((item) => item.id === periodId) ?? periods[0]!,
    [periodId, periods],
  );
  const maxValue = Math.max(...period.values, 4);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <section className={styles.progressSection} aria-labelledby="weekly-progress-title">
      <div className={styles.panelHeading}>
        <h2 id="weekly-progress-title">Weekly Progress</h2>
        <label>
          <span className={styles.srOnly}>Progress period</span>
          <select
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value as typeof periodId)}
          >
            {periods.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={14} />
        </label>
      </div>

      <div className={styles.weeklyBody}>
        <div className={styles.weeklyStats}>
          <div>
            <span className={styles.greenIcon}>
              <Flame size={16} />
            </span>
            <strong>{period.streakDays}</strong>
            <small>Day Streak</small>
          </div>
          <div>
            <span className={styles.greenIcon}>
              <Clock3 size={16} />
            </span>
            <strong>{period.hours}</strong>
            <small>Hours This Week</small>
          </div>
        </div>
        <div className={styles.chart} aria-label={`${period.label} study hours`} role="img">
          <div className={styles.chartGrid} aria-hidden="true">
            {[4, 3, 2, 1, 0].map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
          <div className={styles.chartColumns}>
            {period.values.map((value, index) => (
              <div className={styles.chartColumn} key={`${dayLabels[index]}-${value}`}>
                <span
                  aria-label={`${dayLabels[index]} ${value} hours`}
                  style={{ height: `${(value / maxValue) * 100}%` }}
                />
                <small>{dayLabels[index]}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className={styles.momentum}>
        <span aria-hidden="true" /> Great consistency! You&apos;re building real momentum.
      </p>
    </section>
  );
}

function TargetPanel() {
  const target = studentDashboardMock.toeflTarget;
  const progress = (target.currentScore / target.maximumScore) * 100;
  const marker = (target.targetScore / target.maximumScore) * 100;
  return (
    <section className={styles.targetSection} aria-labelledby="toefl-target-title">
      <div className={styles.targetHeading}>
        <h2 id="toefl-target-title">Target: TOEFL {target.targetScore}</h2>
        <span>
          <Target size={20} />
        </span>
      </div>
      <div className={styles.scoreRow}>
        <strong>{target.currentScore}</strong>
        <span>
          Current Score
          <br />
          Overall
        </span>
      </div>
      <div
        className={styles.targetProgress}
        role="progressbar"
        aria-label="TOEFL target progress"
        aria-valuemin={0}
        aria-valuemax={target.maximumScore}
        aria-valuenow={target.currentScore}
      >
        <span style={{ width: `${progress}%` }} />
        <i style={{ left: `${marker}%` }} />
      </div>
      <div className={styles.scoreScale}>
        <span>0</span>
        <span style={{ left: `${marker}%` }}>{target.targetScore}</span>
        <span>{target.maximumScore}</span>
      </div>
      <p>
        You&apos;re on track to reach your target. Keep focusing on academic vocabulary and speaking
        fluency.
      </p>
      <Link className={styles.breakdownLink} href="/student/progress">
        <BarChart3 size={16} /> View score breakdown <ChevronRight size={15} />
      </Link>
    </section>
  );
}

function MotivationCard() {
  return (
    <aside className={styles.motivationCard} aria-label="Daily motivation">
      <span className={styles.motivationMark}>
        <Crown size={22} />
      </span>
      <div>
        <strong>Excellence is a habit.</strong>
        <p>Small steps every day lead to extraordinary results.</p>
      </div>
    </aside>
  );
}

export function StudentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = navigationOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [navigationOpen]);

  return (
    <div className={styles.dashboard}>
      <DashboardSidebar open={navigationOpen} onClose={() => setNavigationOpen(false)} />
      <div className={styles.page}>
        <DashboardHeader onMenu={() => setNavigationOpen(true)} />
        <main
          className={`${styles.main} ${pathname === '/student' ? '' : styles.routeMain}`}
          id="main-content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function StudentDashboard() {
  const { learner, skills } = studentDashboardMock;

  return (
    <>
      <section className={styles.welcome}>
        <h1>Good evening, {learner.firstName}</h1>
        <p>Your personalized path to academic English</p>
      </section>

      <div className={styles.dashboardGrid}>
        <div className={styles.primaryColumn}>
          <ContinueLearningCard />
          <section aria-label="Language skills" className={styles.skillsGrid}>
            {skills.map((skill) => (
              <SkillCard key={skill.id} skill={skill} />
            ))}
          </section>
          <TodayPlan />
        </div>
        <div className={styles.secondaryColumn}>
          <div className={styles.insightPanel}>
            <WeeklyProgressPanel />
            <TargetPanel />
          </div>
          <MotivationCard />
        </div>
      </div>
    </>
  );
}
