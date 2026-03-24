import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { App } from "@/pages";

export default function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
      </Routes>
    </Router>
  );
}
