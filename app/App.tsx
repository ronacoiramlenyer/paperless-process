import { Routes, Route, Link } from "react-router-dom";
import CreateEnvelope from "./pages/CreateEnvelope";
import OwnerDashboard from "./pages/OwnerDashboard";
import SignerView from "./pages/SignerView";

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="brand">
          Paperless Process
        </Link>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<CreateEnvelope />} />
          <Route path="/owner/:ownerToken" element={<OwnerDashboard />} />
          <Route path="/sign/:token" element={<SignerView />} />
          <Route path="*" element={<p className="empty-state">Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
