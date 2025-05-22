#!/bin/bash

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Create necessary directories
echo "Creating directories..."
mkdir -p app/uploads app/results

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd frontend
npm install

echo "Setup complete!"
echo "To run the backend: python app.py"
echo "To run the frontend in development mode: cd frontend && npm start" 