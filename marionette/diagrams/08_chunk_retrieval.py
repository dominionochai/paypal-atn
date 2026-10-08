#!/usr/bin/env python3
"""
Chunk-Based Semantic Retrieval - RAG with overlapping chunks
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('ChunkRetrieval', comment='Chunk-Based Retrieval')
dot.attr(rankdir='TB', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', nodesep='0.8', ranksep='1.2',
         splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# Storage Phase
with dot.subgraph(name='cluster_storage') as c:
    c.attr(label='Storage: Chunking & Embedding', style='rounded,filled',
           fillcolor='#e3f2fd', color='#2c3e50', fontsize='14', penwidth='2.5')
    c.node('page', 'Captured Page\n5,000 words', fillcolor='#bbdefb')
    c.node('chunk', 'Split into Chunks\n500 chars + 100 overlap', 
           fillcolor='#bbdefb', fontsize='12')
    c.node('chunks_list', 'Chunks:\n[0] First 500...\n[1] chars 400-900...\n[2] chars 800-1300...\n...', 
           fillcolor='#ffcdd2', shape='note', fontsize='11')
    c.node('embed_chunks', 'Embed Each Chunk\n384D vectors', fillcolor='#e1bee7')
    c.node('store_both', 'IndexedDB\nPages + Chunks', fillcolor='#c8e6c9',
           shape='cylinder')
    
    c.edge('page', 'chunk')
    c.edge('chunk', 'chunks_list', style='dotted', label='~10 chunks')
    c.edge('chunks_list', 'embed_chunks')
    c.edge('embed_chunks', 'store_both', label='with pageId')

# Retrieval Phase
with dot.subgraph(name='cluster_retrieval') as c:
    c.attr(label='Retrieval: Semantic Chunk Search', style='rounded,filled',
           fillcolor='#fff3e0', color='#2c3e50', fontsize='14', penwidth='2.5')
    c.node('query', 'Query:\n"email address"', fillcolor='#ffe0b2')
    c.node('embed_q', 'Embed Query\n384D vector', fillcolor='#e1bee7')
    c.node('compare', 'Compare with\nAll Chunks', fillcolor='#e1bee7')
    c.node('filter', 'Filter >20%\nSimilarity', fillcolor='#e1bee7', fontsize='12')
    c.node('group', 'Group by Page\nTop 2-3 per page', fillcolor='#c8e6c9', fontsize='12')
    c.node('results', 'Results:\nPage + Relevant\nChunks Only', 
           fillcolor='#ffe0b2', shape='note')
    
    c.edge('query', 'embed_q')
    c.edge('embed_q', 'compare')
    c.edge('compare', 'filter', label='cosine\nsimilarity')
    c.edge('filter', 'group')
    c.edge('group', 'results', label='rank by\nbest match')

# Connect storage to retrieval
dot.edge('store_both', 'compare', style='dotted', label='fetch all\nchunks')

# Benefits box
dot.node('benefits', 'BENEFITS:\n• Finds content anywhere in long pages\n• Returns only relevant sections\n• Better context for Gemini Nano\n• No token waste on irrelevant text', 
         fillcolor='#c8e6c9', shape='box', fontsize='11', penwidth='3',
         width='3')

# Connect to benefits
dot.edge('results', 'benefits', style='invis')

dot.render('chunk_retrieval', format='png', cleanup=True)
print("✅ chunk_retrieval.png")

