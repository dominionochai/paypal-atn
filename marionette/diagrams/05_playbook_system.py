#!/usr/bin/env python3
"""
Playbook System - On-demand workflow guidance
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('Playbooks', comment='Playbook System')
dot.attr(rankdir='TB', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', nodesep='0.8', ranksep='1.0',
         splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# Start
dot.node('task', 'Complex Task\n"fill this form"', fillcolor='#bbdefb', 
         width='2.5')

# Decision
dot.node('agent', 'Agent Decides\nNeeds Guidance', fillcolor='#bbdefb',
         width='2.5')

# Get playbook
dot.node('get', 'getPlaybook\n("fill-form")', fillcolor='#e1bee7',
         width='2.5')

# Playbook content
dot.node('playbook', 'Playbook Loaded\n\n• Domain context\n• Available tools\n• Common patterns\n• Best practices', 
         fillcolor='#c8e6c9', width='2.5', shape='note', fontsize='12')

# Tools available
dot.node('tools', 'Specialized Tools\nAvailable', fillcolor='#e1bee7',
         shape='note', fontsize='12')

# Execution
dot.node('exec', 'Agent Decides\nAutonomously\n(with context)', fillcolor='#c8e6c9',
         width='2.5')

# Compare with direct
with dot.subgraph(name='cluster_compare') as c:
    c.attr(label='Without Playbook', style='rounded,dashed', color='#7f8c8d',
           fontcolor='#7f8c8d', fontsize='12', fillcolor='#f8f9fa')
    c.node('no_pb', 'Agent lacks\ndomain context,\nlimited tools', 
           fillcolor='#ecf0f1', fontsize='12', width='2.2')

# Flow
dot.edge('task', 'agent')
dot.edge('agent', 'get', label='complex?')
dot.edge('get', 'playbook', label='load')
dot.edge('playbook', 'tools', style='dotted', label='enables')
dot.edge('playbook', 'exec', label='provides context')
dot.edge('tools', 'exec', style='dotted')

# Comparison
dot.edge('agent', 'no_pb', label='no playbook', style='dashed',
         color='#7f8c8d')

dot.render('playbook_system', format='png', cleanup=True)
print("✅ playbook_system.png")
