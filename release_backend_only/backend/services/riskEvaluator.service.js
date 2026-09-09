/* Pure evidence-to-score evaluator. It never performs I/O or changes funds/accounts. */
const severityFor = (score) => score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";
const defaults = Object.freeze({
  VELOCITY: { count: 6, minutes: 10 },
  AMOUNT_ANOMALY: { minimumHistory: 5, multiplier: 4 },
  FAILED_TRANSACTIONS: { count: 4 },
  FAILED_AUTH: { count: 5 },
  NEW_ACCOUNT_ACTIVITY: { days: 7, count: 5 },
  DORMANT_ACTIVATION: { dormantDays: 90, count: 3 },
  RAPID_WALLET_IN_OUT: { minutes: 30, minimumAmount: 10000 },
  INCOMPLETE_KYC_ACTIVITY: { count: 4 },
});
const evaluate = (rule, evidence = {}) => {
  const c = { ...(defaults[rule.code] || {}), ...(rule.configuration || {}) };
  let triggered = false, text = "", detail = {};
  if (rule.code === "VELOCITY") { triggered = evidence.recentTransactionCount >= c.count; text = `${evidence.recentTransactionCount || 0} transactions in ${c.minutes} minutes (threshold ${c.count}).`; detail = { count: evidence.recentTransactionCount || 0, minutes: c.minutes }; }
  if (rule.code === "AMOUNT_ANOMALY") { triggered = evidence.historyCount >= c.minimumHistory && evidence.amount >= (evidence.historyAverage * c.multiplier); text = `Amount ${evidence.amount || 0} is at least ${c.multiplier}x the observed customer average.`; detail = { amount: evidence.amount || 0, historyCount: evidence.historyCount || 0, historyAverage: evidence.historyAverage || 0, multiplier: c.multiplier }; }
  if (rule.code === "FAILED_TRANSACTIONS") { triggered = evidence.failedTransactionCount >= c.count; text = `${evidence.failedTransactionCount || 0} failed transactions observed (threshold ${c.count}).`; detail = { count: evidence.failedTransactionCount || 0 }; }
  if (rule.code === "FAILED_AUTH") { triggered = evidence.failedAuthCount >= c.count; text = `${evidence.failedAuthCount || 0} failed authentication events observed (threshold ${c.count}).`; detail = { count: evidence.failedAuthCount || 0 }; }
  if (rule.code === "NEW_ACCOUNT_ACTIVITY") { triggered = evidence.accountAgeDays <= c.days && evidence.recentTransactionCount >= c.count; text = `New account activity meets the conservative review threshold.`; detail = { accountAgeDays: evidence.accountAgeDays, count: evidence.recentTransactionCount || 0 }; }
  if (rule.code === "DORMANT_ACTIVATION") { triggered = evidence.priorDormancyDays >= c.dormantDays && evidence.recentTransactionCount >= c.count; text = `Previously dormant account resumed high activity.`; detail = { dormantDays: evidence.priorDormancyDays || 0, count: evidence.recentTransactionCount || 0 }; }
  if (rule.code === "RAPID_WALLET_IN_OUT") { triggered = evidence.walletInAmount >= c.minimumAmount && evidence.walletOutAmount >= c.minimumAmount; text = `Observed wallet funding and outflow within ${c.minutes} minutes.`; detail = { walletInAmount: evidence.walletInAmount || 0, walletOutAmount: evidence.walletOutAmount || 0, minutes: c.minutes }; }
  if (rule.code === "INCOMPLETE_KYC_ACTIVITY") { triggered = evidence.kycIncomplete === true && evidence.recentTransactionCount >= c.count; text = `Incomplete KYC with elevated activity.`; detail = { kycIncomplete: evidence.kycIncomplete === true, count: evidence.recentTransactionCount || 0 }; }
  const score = triggered ? Math.max(0, Math.min(100, Number(rule.score || 0))) : 0;
  return { triggered, score, severity: severityFor(score), reasons: triggered ? [{ code: rule.code, text, evidence: detail }] : [] };
};
module.exports = { defaults, severityFor, evaluate };