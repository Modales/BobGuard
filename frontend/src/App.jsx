import { ReviewProvider } from './state/ReviewContext';
import DashboardHeader from './components/DashboardHeader';
import WorkflowTimeline from './components/WorkflowTimeline';
import VulnerabilitySelector from './components/VulnerabilitySelector';
import DiffViewer from './components/DiffViewer';
import ExplanationPanel from './components/ExplanationPanel';
import AgentConsensusPanel from './components/AgentConsensusPanel';
import EventTimeline from './components/EventTimeline';
import './App.css';

function Dashboard() {
  return (
    <div className="dashboard">
      <div className="dashboard-top-nav">
        <DashboardHeader />
        <WorkflowTimeline />
      </div>
      <main className="dashboard-main">
        <section className="workspace-main" aria-label="Code Review Workspace">
          <VulnerabilitySelector />
          <DiffViewer />
          <ExplanationPanel />
        </section>
        <aside className="workspace-sidebar" aria-label="Review Intelligence and Consensus">
          <AgentConsensusPanel />
          <EventTimeline />
        </aside>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ReviewProvider>
      <Dashboard />
    </ReviewProvider>
  );
}
