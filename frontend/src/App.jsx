import { ReviewProvider, useReview } from './state/ReviewContext';
import LoginForm from './components/LoginForm';
import DashboardHeader from './components/DashboardHeader';
import WorkflowTimeline from './components/WorkflowTimeline';
import VulnerabilitySelector from './components/VulnerabilitySelector';
import DiffViewer from './components/DiffViewer';
import ExplanationPanel from './components/ExplanationPanel';
import AgentConsensusPanel from './components/AgentConsensusPanel';
import EventTimeline from './components/EventTimeline';
import ROICard from './components/ROICard';
import './App.css';

function DashboardGate() {
  const { state } = useReview();

  // Show login screen if:
  // - Not authenticated AND apiMode hasn't been explicitly set to 'demo'
  // - This means first-time visitors see the login (with "Demo Mode" option)
  const needsLogin = !state.isAuthenticated && state.apiMode !== 'demo';

  if (needsLogin) {
    return <LoginForm />;
  }

  return <Dashboard />;
}

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
          <ROICard />
          <EventTimeline />
        </aside>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ReviewProvider>
      <DashboardGate />
    </ReviewProvider>
  );
}
