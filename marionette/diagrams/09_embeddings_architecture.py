#!/usr/bin/env python3
"""
Embeddings Architecture - Transformers.js in browser extension
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('EmbeddingsArch', comment='Embeddings Architecture')
dot.attr(rankdir='TB', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', nodesep='0.8', ranksep='1.0',
         splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# Model specs
dot.node('model_spec', 'all-MiniLM-L6-v2\n\n• 23MB ONNX model\n• 384 dimensions\n• Mean pooling\n• Normalized vectors\n• 100-300ms inference', 
         fillcolor='#e1bee7', shape='note', fontsize='11', penwidth='3',
         width='2.5')

# Loading flow
with dot.subgraph(name='cluster_loading') as c:
    c.attr(label='Model Loading (First Use)', style='rounded,filled',
           fillcolor='#e3f2fd', color='#2c3e50', fontsize='14', penwidth='2.5')
    c.node('request', 'First\ngenerateEmbedding()', fillcolor='#bbdefb')
    c.node('check', 'Pipeline\nExists?', fillcolor='#bbdefb', shape='diamond')
    c.node('load', 'Download from CDN\nXenova/all-MiniLM-L6-v2', 
           fillcolor='#ffcdd2', fontsize='12')
    c.node('init', 'Initialize Pipeline\nONNX Runtime WASM', fillcolor='#ffcdd2')
    c.node('singleton', 'Store in\nSingleton', fillcolor='#c8e6c9')
    c.node('ready', 'Ready for\nInference', fillcolor='#c8e6c9')
    
    c.edge('request', 'check')
    c.edge('check', 'load', label='no')
    c.edge('check', 'ready', label='yes (cached)')
    c.edge('load', 'init', label='~23MB\ndownload')
    c.edge('init', 'singleton')
    c.edge('singleton', 'ready')

# Configuration
dot.node('config', 'Configuration:\n\nenv.allowLocalModels = false\nenv.backends.onnx.wasm.numThreads = 1\nenv.backends.onnx.wasm.proxy = false\n\n→ Runs on main thread\n→ No worker CSP issues\n→ CDN delivery', 
         fillcolor='#fff3e0', shape='box', fontsize='10', penwidth='2',
         width='3')

# Inference flow
with dot.subgraph(name='cluster_inference') as c:
    c.attr(label='Inference (Cached)', style='rounded,filled',
           fillcolor='#f3e5f5', color='#2c3e50', fontsize='14', penwidth='2.5')
    c.node('text_in', 'Input Text', fillcolor='#e1bee7')
    c.node('tokenize', 'Tokenize\n(WordPiece)', fillcolor='#e1bee7', fontsize='12')
    c.node('forward', 'Forward Pass\nONNX Runtime', fillcolor='#e1bee7')
    c.node('pool', 'Mean Pooling\n+ Normalize', fillcolor='#e1bee7', fontsize='12')
    c.node('vector', 'Float32Array\n384 dimensions', fillcolor='#c8e6c9')
    
    c.edge('text_in', 'tokenize')
    c.edge('tokenize', 'forward')
    c.edge('forward', 'pool')
    c.edge('pool', 'vector', label='100-300ms')

# Connect sections
dot.edge('model_spec', 'load', style='dotted', label='specs')
dot.edge('config', 'init', style='dotted', label='configures')
dot.edge('ready', 'text_in', label='subsequent calls')

# Why it helps Gemini Nano
dot.node('nano_boost', 'WHY THIS BOOSTS GEMINI NANO:\n\n1. Token Efficiency: Returns 150-300 tokens vs 4,000-8,000\n2. Semantic Search: Finds by meaning, not keywords\n3. Chunk Precision: Only relevant sections, not full pages\n4. Context Preservation: 91% of 9,216 tokens available for conversation\n5. Fast Retrieval: 100-300ms embedding + cosine similarity', 
         fillcolor='#c8e6c9', shape='box', fontsize='11', penwidth='3',
         width='4')

dot.edge('vector', 'nano_boost', style='invis')

dot.render('embeddings_architecture', format='png', cleanup=True)
print("✅ embeddings_architecture.png")

