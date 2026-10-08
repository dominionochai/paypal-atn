#!/usr/bin/env python3
"""
Agent Loop - Core loopback mechanism
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('Loop', comment='Agent Loop')
dot.attr(rankdir='LR', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='14', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='12', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

dot.node('agent', 'Prompt API', fillcolor='#bbdefb', width='2')
dot.node('parse', 'Parse', fillcolor='#bbdefb', width='2')
dot.node('tool', 'Execute\nTool', fillcolor='#ce93d8', width='2')
dot.node('result', 'TOOL\nRESULT', fillcolor='#ffcdd2', width='2')

dot.edge('agent', 'parse', label='stream')
dot.edge('parse', 'tool', label='<function_call>')
dot.edge('tool', 'result', label='JSON')
dot.edge('result', 'agent', label='continue', color='#c62828', penwidth='3')

# Exit path
dot.edge('parse', 'agent', label='no tool\n(done)', style='dashed', 
         color='#7f8c8d', constraint='false')

dot.render('agent_loop', format='png', cleanup=True)
print("✅ agent_loop.png")
