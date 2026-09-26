import { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import mockData from '../data/mockData.json';
import { WORKFLOW_STAGES, deriveAgentState, computeDiffLines, getLineExplanation } from './dataHelpers';

// ─── Initial State ──────────────────────────────────────────────────────────

const initialState = {
  /** Raw data from orchestrator-derived mockData.json */
  mockData,

  /** Current workflow stage index in WORKFLOW_STAGES */
  workflowStageIndex: 0,

  /** Per-agent runtime states, keyed by agent id */
  agentStates: {
    security_expert: 'waiting',
    performance_guru: 'waiting',
    legacy_maintainer: 'waiting',
  },

  /** Which vulnerability is currently selected for diff view */
  selectedVulnerabilityId: mockData.vulnerabilities[0]?.id || null,

  /** Selected diff line number (1-indexed), or null */
  selectedDiffLine: null,

  /** Current explanation object for the selected line */
  currentExplanation: null,

  /** Pre-computed diff lines for each vulnerability */
  diffsByVulnerability: {},

  /** Animation progress 0-100 */
  animationProgress: 0,

  /** Whether the timed review sequence is playing */
  isPlaying: false,

  /** The index into event_timeline that we've revealed so far */
  timelineRevealIndex: -1,
};

// Pre-compute diffs from refactor data
mockData.refactors.forEach((refactor) => {
  initialState.diffsByVulnerability[refactor.vulnerabilityId] = computeDiffLines(
    refactor.original_code,
    refactor.refactored_code
  );
});

// ─── Reducer ────────────────────────────────────────────────────────────────

function reviewReducer(state, action) {
  switch (action.type) {
    case 'START_REVIEW':
      return {
        ...state,
        workflowStageIndex: 1,
        isPlaying: true,
        animationProgress: 0,
        timelineRevealIndex: -1,
        selectedDiffLine: null,
        currentExplanation: null,
        agentStates: {
          security_expert: 'waiting',
          performance_guru: 'waiting',
          legacy_maintainer: 'waiting',
        },
      };

    case 'ADVANCE_STAGE': {
      const nextIndex = Math.min(state.workflowStageIndex + 1, WORKFLOW_STAGES.length - 1);
      const nextStage = WORKFLOW_STAGES[nextIndex];

      // Derive agent states from critique data for the selected vulnerability
      const newAgentStates = {};
      for (const agent of state.mockData.agents) {
        const critique = agent.critiques.find(
          (c) => c.vulnerabilityId === state.selectedVulnerabilityId
        );
        newAgentStates[agent.id] = deriveAgentState(critique, nextStage);
      }

      return {
        ...state,
        workflowStageIndex: nextIndex,
        agentStates: newAgentStates,
        isPlaying: nextIndex < WORKFLOW_STAGES.length - 1,
      };
    }

    case 'SET_AGENT_STATE':
      return {
        ...state,
        agentStates: {
          ...state.agentStates,
          [action.agentId]: action.agentState,
        },
      };

    case 'SELECT_VULNERABILITY': {
      const newAgentStates = {};
      const stage = WORKFLOW_STAGES[state.workflowStageIndex];
      for (const agent of state.mockData.agents) {
        const critique = agent.critiques.find(
          (c) => c.vulnerabilityId === action.vulnerabilityId
        );
        newAgentStates[agent.id] = deriveAgentState(critique, stage);
      }

      return {
        ...state,
        selectedVulnerabilityId: action.vulnerabilityId,
        selectedDiffLine: null,
        currentExplanation: null,
        agentStates: newAgentStates,
      };
    }

    case 'SELECT_DIFF_LINE': {
      const diffLines = state.diffsByVulnerability[state.selectedVulnerabilityId] || [];
      const diffLine = diffLines.find((l) => l.lineNumber === action.lineNumber);
      const explanation = getLineExplanation(
        state.mockData.lineExplanations,
        state.selectedVulnerabilityId,
        action.lineNumber,
        diffLine
      );
      return {
        ...state,
        selectedDiffLine: action.lineNumber,
        currentExplanation: explanation,
      };
    }

    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedDiffLine: null,
        currentExplanation: null,
      };

    case 'TICK_PROGRESS': {
      const newProgress = Math.min(state.animationProgress + action.delta, 100);
      return {
        ...state,
        animationProgress: newProgress,
      };
    }

    case 'REVEAL_TIMELINE_EVENT':
      return {
        ...state,
        timelineRevealIndex: action.index,
      };

    case 'RESET':
      return {
        ...initialState,
        diffsByVulnerability: state.diffsByVulnerability,
      };

    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

const ReviewContext = createContext(null);

export function ReviewProvider({ children }) {
  const [state, dispatch] = useReducer(reviewReducer, initialState);
  const timerRef = useRef(null);

  /**
   * Deterministic demo/replay: timed sequence through all workflow stages.
   * Timing is derived from the number of event_timeline entries to pace
   * the reveal naturally.
   */
  const startReview = useCallback(() => {
    dispatch({ type: 'RESET' });
    // Small delay to let reset render, then start
    setTimeout(() => {
      dispatch({ type: 'START_REVIEW' });
    }, 100);
  }, []);

  const resetReview = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dispatch({ type: 'RESET' });
  }, []);

  // Orchestrate the timed stage progression when isPlaying
  useEffect(() => {
    if (!state.isPlaying) return;

    const stageTimings = {
      1: 1200,  // scanning
      2: 1000,  // cve_lookup
      3: 1500,  // refactoring
      4: 2000,  // reviewing (agents analyzing)
      5: 2000,  // debating
      6: 1500,  // consensus
      7: 1200,  // healing
    };

    const delay = stageTimings[state.workflowStageIndex] || 1500;

    timerRef.current = setTimeout(() => {
      dispatch({ type: 'ADVANCE_STAGE' });
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.isPlaying, state.workflowStageIndex]);

  // Reveal timeline events progressively
  useEffect(() => {
    if (!state.isPlaying) return;

    const totalEvents = state.mockData.event_timeline.length;
    const stageCount = WORKFLOW_STAGES.length - 1; // exclude 'idle'
    const eventsPerStage = Math.ceil(totalEvents / stageCount);
    const targetRevealIndex = Math.min(
      (state.workflowStageIndex) * eventsPerStage - 1,
      totalEvents - 1
    );

    if (targetRevealIndex > state.timelineRevealIndex) {
      // Stagger reveals
      let current = state.timelineRevealIndex + 1;
      const revealNext = () => {
        if (current <= targetRevealIndex) {
          dispatch({ type: 'REVEAL_TIMELINE_EVENT', index: current });
          current++;
          setTimeout(revealNext, 200);
        }
      };
      revealNext();
    }
  }, [state.workflowStageIndex, state.isPlaying]);

  // Tick animation progress based on workflow stage
  useEffect(() => {
    const stageCount = WORKFLOW_STAGES.length - 1;
    const targetProgress = Math.round((state.workflowStageIndex / stageCount) * 100);

    if (state.animationProgress < targetProgress) {
      const timer = setInterval(() => {
        dispatch({ type: 'TICK_PROGRESS', delta: 2 });
      }, 30);
      return () => clearInterval(timer);
    }
  }, [state.workflowStageIndex, state.animationProgress]);

  const value = {
    state,
    dispatch,
    startReview,
    resetReview,
    currentStage: WORKFLOW_STAGES[state.workflowStageIndex],
    stages: WORKFLOW_STAGES,
  };

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

export function useReview() {
  const context = useContext(ReviewContext);
  if (!context) {
    throw new Error('useReview must be used within a ReviewProvider');
  }
  return context;
}
