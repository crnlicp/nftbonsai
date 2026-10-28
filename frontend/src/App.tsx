import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./components/AuthProvider";
import { Layout } from "./components/Layout";
import { Landing } from "./pages/Landing";
import { Mint } from "./pages/Mint";
import { MyNFTs } from "./pages/MyNFTs";
import { Gallery } from "./pages/Gallery";
import { Wallet } from "./pages/Wallet";
import { ArtLab } from "./pages/ArtLab";
import { Bonsai } from "./pages/Bonsai";

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/mint" element={<Mint />} />
            <Route path="/my-nfts" element={<MyNFTs />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/bonsai" element={<Bonsai />} />
            <Route path="/art-lab" element={<ArtLab />} />
            <Route path="*" element={<Landing />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
