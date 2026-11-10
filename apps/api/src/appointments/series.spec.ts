import { occurrenceDates } from './series.service.js';

const weekly = { anchorDate: '2030-01-07', intervalWeeks: 1, untilDate: null, maxOccurrences: null };

describe('occurrence dates', () => {
  it('weekly from the anchor up to the horizon, inclusive', () => {
    expect(occurrenceDates(weekly, '2030-01-28')).toEqual(['2030-01-07', '2030-01-14', '2030-01-21', '2030-01-28']);
  });

  it('biweekly', () => {
    expect(occurrenceDates({ ...weekly, intervalWeeks: 2 }, '2030-02-10')).toEqual(['2030-01-07', '2030-01-21', '2030-02-04']);
  });

  it('stops at the series’ last date or at its number of occurrences', () => {
    expect(occurrenceDates({ ...weekly, untilDate: '2030-01-20' }, '2030-12-31')).toEqual(['2030-01-07', '2030-01-14']);
    expect(occurrenceDates({ ...weekly, maxOccurrences: 3 }, '2030-12-31')).toEqual(['2030-01-07', '2030-01-14', '2030-01-21']);
  });

  it('extending the horizon yields only the dates after the previous one', () => {
    expect(occurrenceDates(weekly, '2030-02-04', '2030-01-21')).toEqual(['2030-01-28', '2030-02-04']);
  });

  it('a count limit still counts the dates before the previous horizon', () => {
    expect(occurrenceDates({ ...weekly, maxOccurrences: 3 }, '2030-12-31', '2030-01-14')).toEqual(['2030-01-21']);
  });
});
