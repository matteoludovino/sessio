import { addDays, fitsWorkingHours, localTime, zonedInstant } from './clinic-time.js';

const SP = 'America/Sao_Paulo'; // UTC-3, no daylight saving time since 2019
const mondayMorning = [{ weekday: 1, startMinute: 8 * 60, endMinute: 12 * 60 }];

describe('clinic time', () => {
  it('reads the local weekday and time in the clinic’s zone', () => {
    // 2027-03-08 is a Monday; 11:00Z is 08:00 in São Paulo
    expect(localTime(new Date('2027-03-08T11:00:00Z'), SP)).toEqual({ date: '2027-03-08', weekday: 1, minute: 480 });
    // 01:00Z on Tuesday is still Monday 22:00 in São Paulo
    expect(localTime(new Date('2027-03-09T01:00:00Z'), SP)).toMatchObject({ date: '2027-03-08', weekday: 1, minute: 1320 });
  });

  it('a session fits when it lies entirely inside one range', () => {
    expect(fitsWorkingHours(new Date('2027-03-08T11:00:00Z'), new Date('2027-03-08T11:50:00Z'), SP, mondayMorning)).toBe(true);
    // ends exactly at 12:00
    expect(fitsWorkingHours(new Date('2027-03-08T14:10:00Z'), new Date('2027-03-08T15:00:00Z'), SP, mondayMorning)).toBe(true);
  });

  it('a session that starts before or runs past the range does not fit', () => {
    expect(fitsWorkingHours(new Date('2027-03-08T10:30:00Z'), new Date('2027-03-08T11:20:00Z'), SP, mondayMorning)).toBe(false);
    expect(fitsWorkingHours(new Date('2027-03-08T14:30:00Z'), new Date('2027-03-08T15:20:00Z'), SP, mondayMorning)).toBe(false);
  });

  it('the same instant is another weekday elsewhere, so the zone matters', () => {
    // 2027-03-08T11:00Z is 08:00 Monday in São Paulo but 20:00 Monday in Tokyo: outside the range
    expect(fitsWorkingHours(new Date('2027-03-08T11:00:00Z'), new Date('2027-03-08T11:50:00Z'), 'Asia/Tokyo', mondayMorning)).toBe(false);
  });

  it('never fits across local midnight; ending at 24:00 is fine', () => {
    const late = [{ weekday: 1, startMinute: 20 * 60, endMinute: 24 * 60 }];
    // Monday 23:10 → 00:00 São Paulo
    expect(fitsWorkingHours(new Date('2027-03-09T02:10:00Z'), new Date('2027-03-09T03:00:00Z'), SP, late)).toBe(true);
    // Monday 23:30 → 00:20
    expect(fitsWorkingHours(new Date('2027-03-09T02:30:00Z'), new Date('2027-03-09T03:20:00Z'), SP, late)).toBe(false);
  });
});

describe('local time to instant', () => {
  it('maps São Paulo wall-clock time to UTC', () => {
    expect(zonedInstant('2030-01-07', 8 * 60, SP).toISOString()).toBe('2030-01-07T11:00:00.000Z');
    expect(zonedInstant('2030-01-07', 23 * 60 + 30, SP).toISOString()).toBe('2030-01-08T02:30:00.000Z');
  });

  it('round-trips with localTime', () => {
    const instant = zonedInstant('2030-06-15', 14 * 60 + 5, SP);
    expect(localTime(instant, SP)).toMatchObject({ date: '2030-06-15', minute: 14 * 60 + 5 });
  });

  it('follows daylight saving time where it exists', () => {
    // New York: UTC-5 in January, UTC-4 in July
    expect(zonedInstant('2030-01-15', 9 * 60, 'America/New_York').toISOString()).toBe('2030-01-15T14:00:00.000Z');
    expect(zonedInstant('2030-07-15', 9 * 60, 'America/New_York').toISOString()).toBe('2030-07-15T13:00:00.000Z');
  });

  it('adds calendar days across months and years', () => {
    expect(addDays('2030-01-28', 7)).toBe('2030-02-04');
    expect(addDays('2030-12-30', 14)).toBe('2031-01-13');
  });
});
