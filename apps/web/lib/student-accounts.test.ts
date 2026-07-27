import { describe, expect, it } from 'vitest';
import {
  credentialsCsv,
  parseStudentAccountCsv,
  studentAccountTemplateCsv,
} from './student-accounts';

describe('student account CSV', () => {
  it('parses English and Chinese headers, quoted values, and optional fields', () => {
    const rows = parseStudentAccountCsv(
      '\uFEFF登录名,姓名,学号,年级,邮箱\nstudent01,"张, 同学",S-01,Grade 7,\n',
    );
    expect(rows).toEqual([
      {
        loginName: 'student01',
        displayName: '张, 同学',
        studentNumber: 'S-01',
        gradeLevel: 'Grade 7',
        email: null,
      },
    ]);
  });

  it('rejects files without the required identity columns', () => {
    expect(() => parseStudentAccountCsv('email,grade\nstudent@example.com,7')).toThrow(
      /loginName/u,
    );
  });

  it('exports temporary credentials as a round-trippable CSV', () => {
    const csv = credentialsCsv([
      {
        membershipId: '01900000-0000-7000-8000-000000000001',
        loginName: 'student01',
        displayName: '张, 同学',
        email: null,
        studentNumber: 'S01',
        gradeLevel: 'Grade 7',
        temporaryPassword: 'Temp-Password-1!',
        mustChangePassword: true,
      },
    ]);
    expect(csv).toContain('"张, 同学"');
    expect(csv).toContain('Temp-Password-1!');
    expect(studentAccountTemplateCsv()).toContain('loginName,displayName');
  });
});
