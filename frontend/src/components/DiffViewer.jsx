import { useReview } from '../state/ReviewContext';
import { useMemo } from 'react';
import './DiffViewer.css';

/**
 * Minimal Python keyword highlighter for syntax coloring.
 * Avoids external dependencies while providing realistic code rendering.
 */
function highlightPython(code) {
  if (!code) return '';

  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    // Strings (double-quoted, single-quoted, triple-quoted)
    .replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
      '<span class="syn-string">$1</span>')
    // Comments
    .replace(/(#.*)$/gm, '<span class="syn-comment">$1</span>')
    // Keywords
    .replace(
      /\b(import|from|def|return|if|else|elif|for|while|class|try|except|finally|with|as|in|not|and|or|True|False|None|raise|pass|break|continue|yield|lambda|async|await)\b/g,
      '<span class="syn-keyword">$1</span>'
    )
    // Built-in types/functions
    .replace(
      /\b(str|int|float|bool|list|dict|tuple|set|print|len|range|type|isinstance|hasattr|getattr|setattr)\b/g,
      '<span class="syn-builtin">$1</span>'
    )
    // Function definitions
    .replace(
      /\b(def\s+)(\w+)/g,
      '$1<span class="syn-funcname">$2</span>'
    )
    // Decorators
    .replace(/^(\s*@\w+)/gm, '<span class="syn-decorator">$1</span>')
    // Numbers
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="syn-number">$1</span>');
}

const STAGE_STATUS_TEXT = {
  idle: 'Ready for Review',
  scanning: 'Scanning Codebase...',
  cve_lookup: 'CVE Retrieval...',
  refactoring: 'AST Mutation Engine...',
  reviewing: 'Multi-Agent Review...',
  debating: 'Persona Debate...',
  consensus: 'Consensus Reached',
  healing: 'Sandbox Test Execution...',
  completed: 'Review Complete',
};

export default function DiffViewer() {
  const { state, dispatch, currentStage, getActiveData } = useReview();
  const data = getActiveData();
  const vulnId = state.selectedVulnerabilityId;
  const diffLines = state.diffsByVulnerability[vulnId] || [];
  const lineExplanations = useMemo(
    () => data.lineExplanations?.[vulnId] || {},
    [data.lineExplanations, vulnId]
  );

  const refactor = (data.refactors || []).find(
    (r) => r.vulnerabilityId === vulnId
  );

  const vuln = (data.vulnerabilities || []).find((v) => v.id === vulnId);

  const hasExplanation = useMemo(() => {
    const keys = new Set(Object.keys(lineExplanations).map(Number));
    return keys;
  }, [lineExplanations]);

  if (!refactor) {
    return (
      <div className="diff-viewer diff-placeholder">
        <div className="placeholder-content">
          <div className="placeholder-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="6" width="36" height="36" rx="4" stroke="var(--text-muted)" strokeWidth="2" />
              <path d="M16 20h16M16 28h10" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <p>No refactor proposed for this finding.</p>
        </div>
      </div>
    );
  }

  const isLineClickable = (line) => {
    return line.type !== 'context' || hasExplanation.has(line.lineNumber);
  };

  const handleLineClick = (line) => {
    if (isLineClickable(line)) {
      dispatch({ type: 'SELECT_DIFF_LINE', lineNumber: line.lineNumber });
    }
  };

  const stageStatus = STAGE_STATUS_TEXT[currentStage] || 'Reviewing';

  return (
    <div className="diff-viewer" id="diff-viewer">
      <div className="diff-header">
        <div className="diff-title">
          <div className="diff-title-row">
            <h3>Side-by-Side Diff</h3>
            <span className={`diff-stage-badge stage-${currentStage}`}>
              {stageStatus}
            </span>
          </div>
          <span className="diff-file mono">{vuln?.file_path}</span>
        </div>
        <div className="diff-stats">
          <span className="stat-added">
            +{diffLines.filter((l) => l.type === 'added' || l.type === 'modified').length} changed
          </span>
          <span className="stat-removed">
            -{diffLines.filter((l) => l.type === 'removed' || l.type === 'modified').length} removed
          </span>
        </div>
      </div>

      <div className="diff-hint-bar">
        <span>💡 Click any changed line to view AI explanations, agent reasoning, and consensus impact</span>
      </div>

      <div className="diff-content">
        {/* BEFORE column */}
        <div className="diff-column diff-before">
          <div className="column-header">
            <span className="column-label">BEFORE</span>
            <span className="column-tag original">Original (Legacy)</span>
          </div>
          <div className="code-lines">
            {diffLines.map((line) => {
              const isSelected = state.selectedDiffLine === line.lineNumber;
              const hasExp = isLineClickable(line);
              const isChanged = line.type === 'removed' || line.type === 'modified';

              return (
                <div
                  key={`before-${line.lineNumber}`}
                  className={`code-line ${line.type} ${isSelected ? 'selected' : ''} ${hasExp ? 'has-explanation' : ''}`}
                  onClick={() => handleLineClick(line)}
                  role={hasExp ? 'button' : undefined}
                  tabIndex={hasExp ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (hasExp && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleLineClick(line);
                    }
                  }}
                >
                  <span className="line-number">{line.origLineNumber || ''}</span>
                  <span className="line-marker">
                    {isChanged ? '−' : ' '}
                  </span>
                  <code
                    className="line-content"
                    dangerouslySetInnerHTML={{
                      __html: highlightPython(line.original) || '&nbsp;',
                    }}
                  />
                  {hasExp && <span className="explanation-indicator" title="Click for AI explanation">💡</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* AFTER column */}
        <div className="diff-column diff-after">
          <div className="column-header">
            <span className="column-label">AFTER</span>
            <span className="column-tag refactored">Refactored</span>
          </div>
          <div className="code-lines">
            {diffLines.map((line) => {
              const isSelected = state.selectedDiffLine === line.lineNumber;
              const hasExp = isLineClickable(line);
              const isChanged = line.type === 'added' || line.type === 'modified';

              return (
                <div
                  key={`after-${line.lineNumber}`}
                  className={`code-line ${line.type} ${isSelected ? 'selected' : ''} ${hasExp ? 'has-explanation' : ''}`}
                  onClick={() => handleLineClick(line)}
                  role={hasExp ? 'button' : undefined}
                  tabIndex={hasExp ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (hasExp && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleLineClick(line);
                    }
                  }}
                >
                  <span className="line-number">{line.refacLineNumber || ''}</span>
                  <span className="line-marker">
                    {isChanged ? '+' : ' '}
                  </span>
                  <code
                    className="line-content"
                    dangerouslySetInnerHTML={{
                      __html: highlightPython(line.refactored) || '&nbsp;',
                    }}
                  />
                  {hasExp && <span className="explanation-indicator" title="Click for AI explanation">💡</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
