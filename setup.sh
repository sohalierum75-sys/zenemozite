#!/bin/bash

echo "========================================"
echo "  MovieStream - Automated Setup"
echo "========================================"
echo ""

echo "[1/4] Installing Backend Dependencies..."
cd backend
npm install
if [ $? -ne 0 ]; then
    echo "ERROR: Backend installation failed"
    exit 1
fi
echo ""

echo "[2/4] Installing Frontend Dependencies..."
cd ..
npm install
if [ $? -ne 0 ]; then
    echo "ERROR: Frontend installation failed"
    exit 1
fi
echo ""

echo "========================================"
echo "  Installation Complete!"
echo "========================================"
echo ""
echo "To start the application:"
echo ""
echo "1. Backend:  cd backend && npm start"
echo "2. Frontend: npm run dev"
echo ""
echo "Then open: http://localhost:5173"
echo ""
