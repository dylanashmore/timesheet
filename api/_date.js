// Shared date helpers.
//
// The crew works in Florida, so "today" has to be Florida's today. Vercel runs
// its functions in UTC, which after ~7pm ET is already tomorrow — computing the
// cutoff from the raw server clock would quietly let a future date through.
const BUSINESS_TZ = 'America/New_York';

// 'en-CA' formats as YYYY-MM-DD, which matches how dates are stored.
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function isFutureDate(ds) {
  return typeof ds === 'string' && ds > todayStr();
}

module.exports = { todayStr, isFutureDate, BUSINESS_TZ };
