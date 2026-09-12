import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import TamilMovies from './pages/TamilMovies';
import TVShows from './pages/TVShows';
import SingleMovie from './pages/SingleMovie';
import SingleTV from './pages/SingleTV';
import SearchResults from './pages/SearchResults';
import { LocaleProvider } from './context/LocaleContext';

function App() {
  return (
    <Router>
      <LocaleProvider>
      <div className="relative flex flex-col min-h-screen bg-[#0f1115] overflow-hidden">
        {/* Ambient Mesh Glow Atmosphere - Fixed to Viewport */}
        <div className="fixed inset-0 pointer-events-none z-0" aria-hidden="true">
          <div 
            className="absolute top-[10%] left-[15%] h-96 w-96 rounded-full blur-[120px] animate-meshDrift1"
            style={{ backgroundColor: '#ff9900', opacity: 0.06 }}
          />
          <div 
            className="absolute top-[60%] right-[20%] h-[28rem] w-[28rem] rounded-full blur-[140px] animate-meshDrift2"
            style={{ backgroundColor: '#ff9900', opacity: 0.04 }}
          />
          <div 
            className="absolute bottom-[20%] left-[40%] h-80 w-80 rounded-full blur-[100px] animate-meshDrift3"
            style={{ backgroundColor: '#ff9900', opacity: 0.05 }}
          />
        </div>

        {/* Content Layer */}
        <div className="relative z-10 flex flex-col min-h-screen">
          <Navbar />
          <main className="flex-grow">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/tamil" element={<TamilMovies />} />
              <Route path="/tv-shows" element={<TVShows />} />
              <Route path="/movie/:id" element={<SingleMovie />} />
              <Route path="/tv/:id" element={<SingleTV />} />
              <Route path="/search/:query" element={<SearchResults />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </div>
      </LocaleProvider>
    </Router>
  );
}

export default App;
