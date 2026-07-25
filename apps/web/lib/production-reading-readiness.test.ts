import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const alibabaCompose = readFileSync(
  new URL('../../../deploy/alibaba-cloud/docker-compose.ecs.yml', import.meta.url),
  'utf8',
);

describe('production CommonLit reading packaging', () => {
  it.each(['commonlit-reading', 'commonlit-reading-answers', 'commonlit-reading-vocabulary'])(
    'copies %s into the runtime image',
    (directory) => {
      expect(dockerfile).toContain(`/app/apps/web/data/${directory} ./apps/web/data/${directory}`);
    },
  );

  it('enables the reading API in the Alibaba Cloud web container', () => {
    expect(alibabaCompose).toMatch(/ENABLE_LOCAL_READING:\s*'true'/u);
  });
});
