#!/usr/bin/env python3
"""
Tool Routing Architecture - Three execution contexts
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('Routing', comment='Tool Routing')
dot.attr(rankdir='TB', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', nodesep='0.8', ranksep='1.0',
         splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# Start
dot.node('call', 'Tool Call', fillcolor='#bbdefb', width='2')

# Three paths
with dot.subgraph() as s:
    s.attr(rank='same')
    s.node('bg', 'Background\nWorker', fillcolor='#c8e6c9', width='2')
    s.node('ui', 'UI Context', fillcolor='#e1bee7', width='2')
    s.node('cs', 'Content\nScript', fillcolor='#ffcdd2', width='2')

# Examples
dot.node('bg_ex', 'storeMemory\nsearchVault\ngetPlaybook', 
         fillcolor='#e8f5e9', fontsize='11', shape='note')
dot.node('ui_ex', 'writeContent\nsummarizePage', 
         fillcolor='#f3e5f5', fontsize='11', shape='note')
dot.node('cs_ex', 'clickElement\nfillInput\nfindElements', 
         fillcolor='#ffebee', fontsize='11', shape='note')

# Result
dot.node('res', 'Result', fillcolor='#bbdefb', width='2')

# Connections
dot.edge('call', 'bg', label='chrome.runtime\n.sendMessage')
dot.edge('call', 'ui', label='requiresUser\nGesture')
dot.edge('call', 'cs', label='inject script')

dot.edge('bg', 'bg_ex', style='dotted', color='#7f8c8d')
dot.edge('ui', 'ui_ex', style='dotted', color='#7f8c8d')
dot.edge('cs', 'cs_ex', style='dotted', color='#7f8c8d')

dot.edge('bg', 'res')
dot.edge('ui', 'res')
dot.edge('cs', 'res')

dot.render('tool_routing', format='png', cleanup=True)
print("✅ tool_routing.png")
