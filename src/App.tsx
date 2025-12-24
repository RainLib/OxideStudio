import { ConnectionPage } from "./pages/connection";
import { useConnectionStore } from "./store/useConnectionStore";
import "./App.css";

function App() {
  const isConnected = useConnectionStore((state) => state.isConnected);

  if (isConnected) {
      return <div className="h-screen w-screen flex items-center justify-center">Connected! Workspace coming soon...</div>
  }

  return <ConnectionPage />;
}

export default App;
