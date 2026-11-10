import { fitsWorkingHours, localTime } from './clinic-time.js';

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
