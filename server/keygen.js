const crypto = require('crypto');

// ── Plan Definitions ───────────────────────────────────────────────────────
const PLANS = {
  trial: { label: '30-Min Trial',  minutes: 30        },
  '1d':  { label: '1 Day',         minutes: 1_440      },
  '3d':  { label: '3 Days',        minutes: 4_320      },
  '7d':  { label: '7 Days',        minutes: 10_080     },
  '15d': { label: '15 Days',       minutes: 21_600     },
  '1m':  { label: '1 Month',       minutes: 43_200     },
  '3m':  { label: '3 Months',      minutes: 129_600    },
  '6m':  { label: '6 Months',      minutes: 259_200    },
  '1y':  { label: '1 Year',        minutes: 525_600    },
};

// ── Key Generation ─────────────────────────────────────────────────────────
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Returns a random segment of `length` characters from CHARS,
 * using crypto.randomBytes for strong entropy.
 */
function randomSegment(length) {
  const bytes = crypto.randomBytes(length * 2); // oversample for uniform dist.
  let result = '';
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const idx = bytes[i] % CHARS.length;
    // Rejection sampling: skip if idx >= (256 - 256 % CHARS.length) to avoid bias
    if (bytes[i] < 256 - (256 % CHARS.length)) {
      result += CHARS[idx];
    }
  }
  // Fallback if we still need more chars (extremely rare)
  while (result.length < length) {
    result += CHARS[crypto.randomBytes(1)[0] % CHARS.length];
  }
  return result;
}

/**
 * Generates a key in the format: MNTHNNNN-XXXX-XXXX-XXXX
 */
function generateKey() {
  return `MNTHNNNN-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
}

module.exports = { generateKey, PLANS };
