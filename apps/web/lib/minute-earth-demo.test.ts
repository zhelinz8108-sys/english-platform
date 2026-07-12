import { describe, expect, it } from 'vitest';
import { minuteEarthDemoEpisodes } from './minute-earth-demo';

describe('Minute Earth demo fallback', () => {
  it('provides expandable listening content without a backend', () => {
    expect(minuteEarthDemoEpisodes.length).toBeGreaterThan(0);
    expect(new Set(minuteEarthDemoEpisodes.map((episode) => episode.id)).size).toBe(
      minuteEarthDemoEpisodes.length,
    );
    expect(
      minuteEarthDemoEpisodes.every(
        (episode) => episode.transcript.length > 0 && episode.vocabulary.length > 0,
      ),
    ).toBe(true);
  });
});
