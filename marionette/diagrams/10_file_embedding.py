#!/usr/bin/env python3
"""
File Embedding - Local document ingestion pipeline
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('FileEmbedding', comment='File Embedding System')
dot.attr(rankdir='LR', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', nodesep='1.0', ranksep='1.5',
         splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# Input
dot.node('file', 'Local File\n(PDF, TXT, MD,\nHTML, JSON)', fillcolor='#bbdefb',
         width='2.0')

# Extraction (split by type)
with dot.subgraph(name='cluster_extract') as c:
    c.attr(label='Text Extraction', style='rounded,filled',
           fillcolor='#ffebee', color='#2c3e50', fontsize='14', penwidth='2.5')
    c.node('pdf', 'pdfjs-dist\n(WebAssembly)', fillcolor='#ffcdd2', width='1.8')
    c.node('text', 'Native\nReaders', fillcolor='#ffcdd2', width='1.8')

# Processing (same as webpages)
dot.node('chunk', 'Chunk Text\n500 chars\n100 char overlap', fillcolor='#e1bee7',
         width='2.0')

dot.node('embed', 'Transformers.js\n384D Embeddings\nall-MiniLM-L6-v2', 
         fillcolor='#e1bee7', width='2.0')

# Storage
dot.node('vault', 'IndexedDB Vault\ndomain: local-files\nurl: file://name\nchunks + vectors', 
         fillcolor='#c8e6c9', width='2.2')

# Retrieval
dot.node('search', 'searchVault()\nCosine Similarity\nReturns Chunks', 
         fillcolor='#fff9c4', width='2.0')

# Flow
dot.edge('file', 'pdf', label='PDF')
dot.edge('file', 'text', label='TXT/MD/\nHTML/JSON')
dot.edge('pdf', 'chunk')
dot.edge('text', 'chunk')
dot.edge('chunk', 'embed', label='per chunk')
dot.edge('embed', 'vault', label='store')
dot.edge('vault', 'search', label='query', style='dashed', color='#7f8c8d')

dot.render('file_embedding', format='png', cleanup=True)
print("✅ file_embedding.png")

