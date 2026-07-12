import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'English Compass',
    template: '%s · English Compass',
  },
  description: '面向机构、教师与学生的个性化英语学习平台',
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f5f7fb',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-scroll-behavior="smooth" lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
