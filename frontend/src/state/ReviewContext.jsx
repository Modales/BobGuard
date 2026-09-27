import { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import mockData from '../data/mockData.json';
import {
  WORKFLOW_STAGES,
  deriveAgentState,
  computeDiffLines,
  getLineExplanation,
  getActiveData,
} from './dataHelpers';
import {
  login as apiLogin,
  getToken,
  clearToken,
  isTokenValid,
  checkBackendHealth,
} from '../api/auth';
import { runModernize } from '../api/modernize';
import { connectSSE } from '../api/sse';

// ─── Initial State ───────────────────────────────────────────────────────────

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

  // ─── Auth state ───────────────────────────────────────────────────────
  isAuthenticated: false,
  token: null,
  user: null, // { username, role }
  authError: null,
  authLoading: false,

  // ─── API mode ─────────────────────────────────────────────────────────
  apiMode: null, // null (shows login) | 'demo' | 'live'
  apiStatus: null,
  apiError: null,
  apiLoading: false,
  backendAvailable: false,

  // ─── Live data (when apiMode === 'live') ──────────────────────────────
  liveData: null, // full ModernizationResponse from POST /modernize

  // ─── SSE tracking ─────────────────────────────────────────────────────
  sseEvents: [], // accumulated SSE events for timeline display

  /** ROI summary — populated from live API response or kept from mockData */
  roiSummary: mockData.roi_summary ?? null,
};

// Pre-compute diffs from refactor data
mockData.refactors.forEach((refactor) => {
  initialState.diffsByVulnerability[refactor.vulnerabilityId] = computeDiffLines(
    refactor.original_code,
    refactor.refactored_code
  );
});

// ─── Reducer ─────────────────────────────────────────────────────────────────

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
        apiMode: 'demo',
        apiStatus: 'Demo mode — local simulation',
        agentStates: {
          security_expert: 'waiting',
          performance_guru: 'waiting',
          legacy_maintainer: 'waiting',
        },
      };

    case 'ADVANCE_STAGE': {
      const nextIndex = Math.min(state.workflowStageIndex + 1, WORKFLOW_STAGES.length - 1);
      const nextStage = WORKFLOW_STAGES[nextIndex];
      const data = getActiveData(state);
      const agents = data.agents || state.mockData.agents;
      const newAgentStates = {};
      for (const agent of agents) {
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
      const data = getActiveData(state);
      const agents = data.agents || state.mockData.agents;
      const newAgentStates = {};
      const stage = WORKFLOW_STAGES[state.workflowStageIndex];
      for (const agent of agents) {
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
      const data = getActiveData(state);
      const explanations = data.lineExplanations || state.mockData.lineExplanations;
      const explanation = getLineExplanation(
        explanations,
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
        // Preserve auth/api state across resets
        isAuthenticated: state.isAuthenticated,
        token: state.token,
        user: state.user,
        apiMode: state.apiMode,
        backendAvailable: state.backendAvailable,
        liveData: null,
        sseEvents: [],
        roiSummary: state.mockData.roi_summary ?? null,
      };

    // ── Auth actions ──────────────────────────────────────────────────

    case 'AUTH_START':
      return { ...state, authLoading: true, authError: null };

    case 'AUTH_SUCCESS':
      return {
        ...state,
        authLoading: false,
        isAuthenticated: true,
        token: action.token,
        user: action.user,
        authError: null,
        apiMode: action.apiMode || 'live',
        apiStatus: 'Connected — live pipeline',
      };

    case 'AUTH_FAILURE':
      return {
        ...state,
        authLoading: false,
        authError: action.error,
        isAuthenticated: false,
        token: null,
        user: null,
      };

    case 'LOGOUT':
      return {
        ...state,
        isAuthenticated: false,
        token: null,
        user: null,
        authError: null,
        apiMode: null,
        apiStatus: null,
        liveData: null,
        sseEvents: [],
      };

    // ── API mode actions ──────────────────────────────────────────────

    case 'SET_API_MODE':
      return {
        ...state,
        apiMode: action.mode,
        liveData: action.mode === 'demo' ? null : state.liveData,
      };

    case 'SET_BACKEND_AVAILABLE':
      return { ...state, backendAvailable: action.available };

    // ── Live pipeline actions ─────────────────────────────────────────

    case 'LIVE_PIPELINE_START':
      return {
        ...state,
        apiLoading: true,
        apiError: null,
        apiStatus: 'Connected — live pipeline',
        workflowStageIndex: 1,
        isPlaying: true,
        animationProgress: 0,
        timelineRevealIndex: -1,
        selectedDiffLine: null,
        currentExplanation: null,
        sseEvents: [],
        agentStates: {
          security_expert: 'waiting',
          performance_guru: 'waiting',
          legacy_maintainer: 'waiting',
        },
      };

    case 'LIVE_STAGE_UPDATE': {
      const stageIndex = WORKFLOW_STAGES.indexOf(action.stage);
      const effectiveIndex =
        stageIndex >= 0
          ? Math.max(state.workflowStageIndex, stageIndex)
          : state.workflowStageIndex;

      // Update agent states according to stage
      const newAgentStates = {};
      const data = getActiveData(state);
      const agents = data.agents || state.mockData.agents;
      for (const agent of agents) {
        const critique = agent.critiques?.find(
          (c) => c.vulnerabilityId === state.selectedVulnerabilityId
        );
        newAgentStates[agent.id] = deriveAgentState(critique, action.stage);
      }

      return {
        ...state,
        workflowStageIndex: effectiveIndex,
        agentStates: { ...state.agentStates, ...newAgentStates },
        sseEvents: [
          ...state.sseEvents,
          {
            topic: action.topic,
            message: action.message,
            level: action.level || 'info',
          },
        ],
        timelineRevealIndex: state.sseEvents.length,
      };
    }

    case 'LIVE_PIPELINE_COMPLETE':
      return {
        ...state,
        apiLoading: false,
        isPlaying: false,
        workflowStageIndex: WORKFLOW_STAGES.length - 1,
        animationProgress: 100,
        apiStatus: 'Pipeline complete',
      };

    case 'LIVE_PIPELINE_ERROR':
      return {
        ...state,
        apiLoading: false,
        apiError: action.error,
        isPlaying: false,
      };

    case 'SET_LIVE_DATA': {
      const newDiffs = { ...state.diffsByVulnerability };
      const liveData = action.data;

      // Map live vulnerabilities to have ids
      if (liveData.vulnerabilities) {
        liveData.vulnerabilities = liveData.vulnerabilities.map((v, i) => ({
          ...v,
          id: v.id || `vuln-${i + 1}`,
        }));
      }

      // Map refactors to have vulnerabilityId association
      if (liveData.refactors && liveData.vulnerabilities) {
        liveData.refactors = liveData.refactors.map((r, i) => {
          const vuln = liveData.vulnerabilities[i];
          const vulnId = vuln?.id || `vuln-${i + 1}`;
          return { ...r, vulnerabilityId: vulnId };
        });

        for (const refactor of liveData.refactors) {
          if (refactor.original_code && refactor.refactored_code) {
            newDiffs[refactor.vulnerabilityId] = computeDiffLines(
              refactor.original_code,
              refactor.refactored_code
            );
          }
        }
      }

      // Format event timeline
      if (liveData.event_timeline && Array.isArray(liveData.event_timeline)) {
        liveData.event_timeline = liveData.event_timeline.map((entry) => {
          if (typeof entry === 'string') {
            const [topic] = entry.split(' ');
            return { topic, message: entry, level: 'info' };
          }
          return entry;
        });
      }

      return {
        ...state,
        liveData,
        roiSummary: liveData.roi_summary || state.roiSummary,
        diffsByVulnerability: newDiffs,
        selectedVulnerabilityId:
          liveData.vulnerabilities?.[0]?.id || state.selectedVulnerabilityId,
      };
    }

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ReviewContext = createContext(null);

export function ReviewProvider({ children }) {
  const [state, dispatch] = useReducer(reviewReducer, initialState);
  const timerRef = useRef(null);
  const sseCleanupRef = useRef(null);

  // ── Check backend availability on mount ─────────────────────────────

  useEffect(() => {
    checkBackendHealth().then((available) => {
      dispatch({ type: 'SET_BACKEND_AVAILABLE', available });
    });

    const existingToken = getToken();
    if (existingToken && isTokenValid()) {
      try {
        const payload = JSON.parse(atob(existingToken.split('.')[1]));
        dispatch({
          type: 'AUTH_SUCCESS',
          token: existingToken,
          user: { username: payload.sub, role: payload.role },
          apiMode: 'live',
        });
      } catch {
        clearToken();
      }
    }
  }, []);

  // ── Authentication ──────────────────────────────────────────────────

  const login = useCallback(async (username, password) => {
    dispatch({ type: 'AUTH_START' });
    try {
      const data = await apiLogin(username, password);
      const payload = JSON.parse(atob(data.access_token.split('.')[1]));
      dispatch({
        type: 'AUTH_SUCCESS',
        token: data.access_token,
        user: { username: payload.sub, role: payload.role },
        apiMode: data.is_demo_fallback ? 'demo' : 'live',
      });
      return data;
    } catch (err) {
      dispatch({ type: 'AUTH_FAILURE', error: err.message });
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }
    dispatch({ type: 'LOGOUT' });
  }, []);

  // ── Demo-mode start review (timer-driven) ───────────────────────────

  const startDemoReview = useCallback(() => {
    dispatch({ type: 'RESET' });
    setTimeout(() => {
      dispatch({ type: 'START_REVIEW' });
    }, 100);
  }, []);

  // ── Live-mode start review (SSE + /modernize) ────────────────────────

  const startLiveReview = useCallback(
    async (repoPath, targetVersion) => {
      if (!state.token) return;

      dispatch({ type: 'LIVE_PIPELINE_START' });

      const cleanup = connectSSE(repoPath, targetVersion, {
        onEvent: ({ topic, stage, message, level }) => {
          if (stage) {
            dispatch({ type: 'LIVE_STAGE_UPDATE', stage, topic, message, level });
          }
        },
        onError: (err) => {
          dispatch({ type: 'LIVE_PIPELINE_ERROR', error: err.message });
        },
        onComplete: async () => {
          try {
            const result = await runModernize(repoPath, targetVersion, state.token);
            dispatch({ type: 'SET_LIVE_DATA', data: result });
            dispatch({ type: 'LIVE_PIPELINE_COMPLETE' });
          } catch (err) {
            if (err.status === 401) {
              logout();
            }
            dispatch({ type: 'LIVE_PIPELINE_ERROR', error: err.message });
          }
        },
      });

      sseCleanupRef.current = cleanup;
    },
    [state.token, logout]
  );

  // ── Unified startReview dispatch ────────────────────────────────────

  const startReview = useCallback(() => {
    if (state.apiMode === 'live' && state.isAuthenticated) {
      const data = getActiveData(state);
      const repoPath = data.pipeline?.repo_path || './legacy-app';
      const targetVersion = data.pipeline?.target_version || 'python3.12';
      startLiveReview(repoPath, targetVersion);
    } else {
      startDemoReview();
    }
  }, [state, startDemoReview, startLiveReview]);

  const resetReview = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (sseCleanupRef.current) {
      sseCleanupRef.current();
      sseCleanupRef.current = null;
    }
    dispatch({ type: 'RESET' });
  }, []);

  // ── Timer-driven stage progression (demo mode only) ─────────────────

  useEffect(() => {
    if (!state.isPlaying) return;
    if (state.apiMode === 'live') return;

    const stageTimings = {
      1: 1200,
      2: 1000,
      3: 1500,
      4: 2000,
      5: 2000,
      6: 1500,
      7: 1200,
    };

    const delay = stageTimings[state.workflowStageIndex] || 1500;

    timerRef.current = setTimeout(() => {
      dispatch({ type: 'ADVANCE_STAGE' });
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.isPlaying, state.workflowStageIndex, state.apiMode]);

  // ── Reveal timeline events progressively (demo mode only) ───────────

  useEffect(() => {
    if (!state.isPlaying) return;
    if (state.apiMode === 'live') return;

    const data = state.apiMode === 'live' && state.liveData ? state.liveData : state.mockData;
    const totalEvents = data.event_timeline?.length || 0;
    const stageCount = WORKFLOW_STAGES.length - 1;
    const eventsPerStage = Math.ceil(totalEvents / stageCount);
    const targetRevealIndex = Math.min(
      state.workflowStageIndex * eventsPerStage - 1,
      totalEvents - 1
    );

    if (targetRevealIndex > state.timelineRevealIndex) {
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
  }, [
    state.workflowStageIndex,
    state.isPlaying,
    state.apiMode,
    state.timelineRevealIndex,
    state.liveData,
    state.mockData,
  ]);

  // ── Progress tick ───────────────────────────────────────────────────

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

  // ── Cleanup SSE on unmount ──────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (sseCleanupRef.current) {
        sseCleanupRef.current();
      }
    };
  }, []);

  const value = {
    state,
    dispatch,
    startReview,
    resetReview,
    login,
    logout,
    currentStage: WORKFLOW_STAGES[state.workflowStageIndex],
    stages: WORKFLOW_STAGES,
    getActiveData: () => getActiveData(state),
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
