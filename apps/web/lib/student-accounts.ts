import type { ApiStudentCredential } from './api-models';

export interface StudentAccountDraft {
  loginName: string;
  displayName: string;
  email?: string | null;
  studentNumber?: string | null;
  gradeLevel?: string | null;
  temporaryPassword?: string;
}

const headerAliases = {
  loginName: ['loginname', '登录名', '账号'],
  displayName: ['displayname', '姓名', '显示名称'],
  email: ['email', '邮箱'],
  studentNumber: ['studentnumber', 'studentno', '学号'],
  gradeLevel: ['gradelevel', 'grade', '年级'],
  temporaryPassword: ['temporarypassword', '临时密码'],
} as const;

function parseCsvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (character === '\n') {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header.toLowerCase()));
}

export function parseStudentAccountCsv(value: string): StudentAccountDraft[] {
  const rows = parseCsvRows(value.replace(/^\uFEFF/u, ''));
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  const columns = Object.fromEntries(
    Object.entries(headerAliases).map(([key, aliases]) => [key, findColumn(headers, aliases)]),
  ) as Record<keyof typeof headerAliases, number>;
  if (columns.loginName < 0 || columns.displayName < 0) {
    throw new Error('CSV 必须包含 loginName（登录名）和 displayName（姓名）两列。');
  }
  return rows.map((row, index) => {
    const loginName = row[columns.loginName]?.trim() ?? '';
    const displayName = row[columns.displayName]?.trim() ?? '';
    if (!loginName || !displayName) {
      throw new Error(`CSV 第 ${index + 2} 行缺少登录名或姓名。`);
    }
    const optional = (column: number) => (column >= 0 ? row[column]?.trim() || null : null);
    const temporaryPassword =
      columns.temporaryPassword >= 0
        ? row[columns.temporaryPassword]?.trim() || undefined
        : undefined;
    return {
      loginName,
      displayName,
      email: optional(columns.email),
      studentNumber: optional(columns.studentNumber),
      gradeLevel: optional(columns.gradeLevel),
      ...(temporaryPassword ? { temporaryPassword } : {}),
    };
  });
}

function csvCell(value: string | null | undefined): string {
  const normalized = value ?? '';
  return /[",\r\n]/u.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

export function credentialsCsv(credentials: ApiStudentCredential[]): string {
  return [
    ['loginName', 'displayName', 'studentNumber', 'gradeLevel', 'email', 'temporaryPassword'],
    ...credentials.map((item) => [
      item.loginName,
      item.displayName ?? '',
      item.studentNumber ?? '',
      item.gradeLevel ?? '',
      item.email ?? '',
      item.temporaryPassword,
    ]),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

export function studentAccountTemplateCsv(): string {
  return [
    'loginName,displayName,studentNumber,gradeLevel,email',
    'student001,张同学,S001,Grade 7,',
  ].join('\r\n');
}
