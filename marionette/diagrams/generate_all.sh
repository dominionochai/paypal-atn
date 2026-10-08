#!/bin/bash
# Generate all Marionette diagrams

echo "🎨 Generating Marionette diagrams..."
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found. Please install Python 3."
    exit 1
fi

# Check if graphviz module is installed
if ! python3 -c "import graphviz" 2>/dev/null; then
    echo "📦 Installing requirements..."
    pip install -r requirements.txt
fi

# Generate each diagram
for diagram in *.py; do
    echo "🔨 Generating $diagram..."
    python3 "$diagram"
done

echo ""
echo "✅ All diagrams generated successfully!"
echo ""
echo "Generated files:"
ls -lh *.png 2>/dev/null | awk '{print "  - " $9 " (" $5 ")"}'

