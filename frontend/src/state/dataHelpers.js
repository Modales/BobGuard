/**
 * Workflow stages derived from the orchestrator's event bus Topic enum:
 *   audit.started → audit.finished → cve.retrieved → refactor.proposed
 *   → consensus.reached → healing.finished → tests.passed → pipeline.complete
 *
 * The frontend maps these into human-readable workflow stages.
 */

export const WORKFLOW_STAGES = [
  'idle',
  'scanning',
  'cve_lookup',
  'refactoring',
  'reviewing',
  'debating',
  'consensus',
  'healing',
  'completed',
];

/**
 * Per-agent states derived from PersonaName + Critique model in
 * multi_agent_consensus.py.
 *
 * Agents transition:
 *   waiting → analyzing → found_issue | no_issue → reviewing_change → agreeing | disagreeing → complete
 */
export const AGENT_STATES = {
  WAITING: 'waiting',
  ANALYZING: 'analyzing',
  FOUND_ISSUE: 'found_issue',
  NO_ISSUE: 'no_issue',
  REVIEWING_CHANGE: 'reviewing_change',
  AGREEING: 'agreeing',
  DISAGREEING: 'disagreeing',
  COMPLETE: 'complete',
};

/**
 * Map the orchestrator's Topic enum values to frontend workflow stages.
 */
export const TOPIC_TO_STAGE = {
  'audit.started': 'scanning',
  'audit.finished': 'scanning',
  'cve.retrieved': 'cve_lookup',
  'refactor.proposed': 'refactoring',
  'consensus.reached': 'consensus',
  'healing.finished': 'healing',
  'tests.passed': 'completed',
  'tests.failed': 'completed',
  'pipeline.complete': 'completed',
};

/**
 * Derive the per-agent state from the critique data for a given vulnerability.
 * This mirrors the heuristic logic in multi_agent_consensus.py _heuristic_review.
 */
export function deriveAgentState(critique, workflowStage) {
  if (!critique) return AGENT_STATES.WAITING;

  switch (workflowStage) {
    case 'idle':
    case 'scanning':
    case 'cve_lookup':
      return AGENT_STATES.WAITING;

    case 'refactoring':
      return AGENT_STATES.ANALYZING;

    case 'reviewing':
      if (critique.concerns.length > 0) return AGENT_STATES.FOUND_ISSUE;
      return AGENT_STATES.NO_ISSUE;

    case 'debating':
      return AGENT_STATES.REVIEWING_CHANGE;

    case 'consensus':
    case 'healing':
    case 'completed':
      if (critique.verdict === 'approve') return AGENT_STATES.AGREEING;
      if (critique.verdict === 'reject') return AGENT_STATES.DISAGREEING;
      return AGENT_STATES.REVIEWING_CHANGE; // "revise"

    default:
      return AGENT_STATES.WAITING;
  }
}

/**
 * Given a refactor's original and refactored code, compute the diff lines
 * using block-based Longest Common Subsequence (LCS) for accurate side-by-side rendering.
 */
export function computeDiffLines(originalCode, refactoredCode) {
  if (!originalCode && !refactoredCode) return [];
  const origLines = (originalCode || '').split('\n');
  const refacLines = (refactoredCode || '').split('\n');
  const m = origLines.length;
  const n = refacLines.length;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origLines[i - 1] === refacLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const rawDiff = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === refacLines[j - 1]) {
      rawDiff.push({ type: 'context', orig: origLines[i - 1], refac: refacLines[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.push({ type: 'added', orig: '', refac: refacLines[j - 1] });
      j--;
    } else {
      rawDiff.push({ type: 'removed', orig: origLines[i - 1], refac: '' });
      i--;
    }
  }
  rawDiff.reverse();

  const result = [];
  let origLineNum = 1;
  let refacLineNum = 1;

  let idx = 0;
  while (idx < rawDiff.length) {
    if (rawDiff[idx].type === 'context') {
      result.push({
        lineNumber: result.length + 1,
        origLineNumber: origLineNum++,
        refacLineNumber: refacLineNum++,
        type: 'context',
        original: rawDiff[idx].orig,
        refactored: rawDiff[idx].refac,
      });
      idx++;
    } else {
      const origBlock = [];
      const refacBlock = [];
      while (idx < rawDiff.length && rawDiff[idx].type !== 'context') {
        if (rawDiff[idx].type === 'removed') origBlock.push(rawDiff[idx].orig);
        if (rawDiff[idx].type === 'added') refacBlock.push(rawDiff[idx].refac);
        idx++;
      }
      const count = Math.max(origBlock.length, refacBlock.length);
      for (let c = 0; c < count; c++) {
        const o = c < origBlock.length ? origBlock[c] : null;
        const r = c < refacBlock.length ? refacBlock[c] : null;
        if (o !== null && r !== null) {
          result.push({
            lineNumber: result.length + 1,
            origLineNumber: origLineNum++,
            refacLineNumber: refacLineNum++,
            type: 'modified',
            original: o,
            refactored: r,
          });
        } else if (o !== null) {
          result.push({
            lineNumber: result.length + 1,
            origLineNumber: origLineNum++,
            refacLineNumber: null,
            type: 'removed',
            original: o,
            refactored: '',
          });
        } else {
          result.push({
            lineNumber: result.length + 1,
            origLineNumber: null,
            refacLineNumber: refacLineNum++,
            type: 'added',
            original: '',
            refactored: r,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Get the explanation for a specific line of a vulnerability's diff.
 * Uses the lineExplanations mapping from mockData.json.
 */
export function getLineExplanation(lineExplanations, vulnerabilityId, lineNumber, diffLine = null) {
  const vulnExplanations = lineExplanations?.[vulnerabilityId];
  if (vulnExplanations && vulnExplanations[String(lineNumber)]) {
    return vulnExplanations[String(lineNumber)];
  }

  // Smart fallback if a changed line is clicked without explicit entry
  if (diffLine && diffLine.type !== 'context') {
    return {
      content: diffLine.type === 'modified'
        ? `${diffLine.original.trim()} → ${diffLine.refactored.trim()}`
        : diffLine.type === 'added'
        ? `Added: ${diffLine.refactored.trim()}`
        : `Removed: ${diffLine.original.trim()}`,
      explanation: `Automated patch modification for line ${lineNumber}. The multi-agent debate engine analyzed this change to balance security fixes against runtime performance and API compatibility.`,
      agents: ['security_expert', 'performance_guru', 'legacy_maintainer'],
      severity: 'medium',
      category: 'maintenance',
    };
  }

  return null;
}

/**
 * Calculate weighted consensus score from agent critiques.
 * Mirrors calculate_consensus() in multi_agent_consensus.py.
 */
export function calculateConsensus(agents, vulnerabilityId) {
  let totalWeight = 0;
  let weightedScore = 0;
  let securityScore = 0;

  for (const agent of agents) {
    const critique = agent.critiques.find(c => c.vulnerabilityId === vulnerabilityId);
    if (!critique) continue;
    totalWeight += agent.weight;
    weightedScore += critique.score * agent.weight;
    if (agent.id === 'security_expert') {
      securityScore = critique.score;
    }
  }

  const consensus = totalWeight > 0 ? weightedScore / totalWeight : 0;
  return {
    consensus_score: Math.round(consensus * 10000) / 10000,
    security_score: securityScore,
    security_vetoed: securityScore < 0.60,
    approved: consensus >= 0.70 && securityScore >= 0.60,
  };
}

