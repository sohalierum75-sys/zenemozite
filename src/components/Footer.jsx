import React from 'react';
import { Link } from 'react-router-dom';
import { Film, Github, Twitter, Mail } from 'lucide-react';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="glass-navbar border-t border-white/5 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand Section */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <Film className="w-8 h-8 text-[var(--accent)] transition-accent" />
              <span className="text-2xl font-bold text-[var(--accent)] transition-accent">CineVault</span>
            </div>
            <p className="text-[#8b94a6] text-sm leading-relaxed max-w-md">
              Your ultimate destination for streaming and downloading the latest movies in high quality. 
              Enjoy unlimited entertainment with our vast collection of films.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/" className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent text-sm">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/tamil" className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent text-sm">
                  Tamil & Malayalam
                </Link>
              </li>
              <li>
                <Link to="/tv-shows" className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent text-sm">
                  TV Shows
                </Link>
              </li>
              <li>
                <a href="#about" className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent text-sm">
                  About Us
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-white font-semibold mb-4">Legal</h3>
            <ul className="space-y-2">
              <li>
                <a href="#privacy" className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent text-sm">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#terms" className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent text-sm">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#dmca" className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent text-sm">
                  DMCA
                </a>
              </li>
              <li>
                <a href="#contact" className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent text-sm">
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Social Links & Copyright */}
        <div className="mt-8 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center">
          <p className="text-[#8b94a6] text-sm">
            © {currentYear} <span className="text-[var(--accent)] transition-accent">CineVault</span>. All rights reserved.
          </p>
          
          {/* Social Icons */}
          <div className="flex items-center space-x-4 mt-4 md:mt-0">
            <a 
              href="https://github.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent"
            >
              <Github className="w-5 h-5" />
            </a>
            <a 
              href="https://twitter.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent"
            >
              <Twitter className="w-5 h-5" />
            </a>
            <a 
              href="mailto:contact@cinevault.com"
              className="text-[#8b94a6] hover:text-[var(--accent)] transition-accent"
            >
              <Mail className="w-5 h-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;