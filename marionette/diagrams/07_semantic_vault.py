#!/usr/bin/env python3
"""
Semantic Vault - Auto-capture and retrieval
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('Vault', comment='Semantic Vault')
dot.attr(rankdir='LR', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', nodesep='1.0', ranksep='1.5',
         splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# Storage path (top)
with dot.subgraph(name='cluster_store') as c:
    c.attr(label='Auto-Capture (Storage)', style='rounded,filled',
           fillcolor='#e3f2fd', color='#2c3e50', fontsize='14', penwidth='2.5')
    c.node('nav', 'Navigate\nto Page', fillcolor='#bbdefb')
    c.node('wait', 'Wait 3s\nfor Settle', fillcolor='#bbdefb', fontsize='12')
    c.node('read', 'Readability.js\nClean Content', fillcolor='#e1bee7')
    c.node('embed_s', 'Transformers.js\n384D Embedding', fillcolor='#e1bee7')
    c.node('store', 'IndexedDB\nStore Entry', fillcolor='#c8e6c9')
    
    c.edge('nav', 'wait')
    c.edge('wait', 'read')
    c.edge('read', 'embed_s', label='text')
    c.edge('embed_s', 'store', label='vector')

# Retrieval path (bottom)
with dot.subgraph(name='cluster_retrieve') as c:
    c.attr(label='Semantic Search (Retrieval)', style='rounded,filled',
           fillcolor='#ffebee', color='#2c3e50', fontsize='14', penwidth='2.5')
    c.node('query', 'searchVault\n"React hooks"', fillcolor='#ffcdd2')
    c.node('embed_r', 'Embed Query\n384D Vector', fillcolor='#e1bee7')
    c.node('db', 'IndexedDB\nFetch All', fillcolor='#c8e6c9')
    c.node('cosine', 'Cosine\nSimilarity', fillcolor='#e1bee7')
    c.node('results', 'Top Matches\n>30% Similar', fillcolor='#ffcdd2',
           shape='note', fontsize='12')
    
    c.edge('query', 'embed_r')
    c.edge('embed_r', 'db', label='compare')
    c.edge('db', 'cosine', label='all vectors')
    c.edge('cosine', 'results', label='rank')

# Shared IndexedDB
dot.node('indexeddb', 'IndexedDB\nmarionette_vault\n\n{url, title, content,\nembedding[], timestamp}',
         fillcolor='#c8e6c9', shape='cylinder', width='2.5', fontsize='12',
         penwidth='3')

# Connect both paths to shared DB
dot.edge('store', 'indexeddb', style='invis')
dot.edge('indexeddb', 'db', style='invis')

dot.render('semantic_vault', format='png', cleanup=True)
print("✅ semantic_vault.png")
