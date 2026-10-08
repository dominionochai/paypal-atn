#!/usr/bin/env python3
"""
Agent Perception - How the agent sees the webpage
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('Perception', comment='Agent Perception')
dot.attr(rankdir='TB', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', nodesep='0.8', ranksep='1.0',
         splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# Top: Webpage
dot.node('page', 'Current Webpage', fillcolor='#c8e6c9', width='3', 
         fontsize='15', penwidth='3')

# Middle: Perception tools
with dot.subgraph() as s:
    s.attr(rank='same')
    s.node('screenshot', 'Screenshot\n(Visual)', fillcolor='#bbdefb')
    s.node('a11y', 'Accessibility Tree\n(Structure)', fillcolor='#bbdefb')
    s.node('readability', 'Readability.js\n(Content)', fillcolor='#bbdefb')
    s.node('context', 'Page Context\n(Title, URL, Date)', fillcolor='#bbdefb')

# Find elements output
dot.node('find', 'findElements\nOutput', fillcolor='#e1bee7',
         shape='note', fontsize='12')

# Bottom: Prompt API
dot.node('prompt', 'Prompt API\n(Agent Vision)', fillcolor='#ffcdd2', 
         width='3', fontsize='15', penwidth='3')

# Connections from page to tools
dot.edge('page', 'screenshot')
dot.edge('page', 'a11y')
dot.edge('page', 'readability')
dot.edge('page', 'context')

# A11y enables findElements
dot.edge('a11y', 'find', style='dotted', label='enables')

# All feed into agent
dot.edge('screenshot', 'prompt', label='image blob')
dot.edge('a11y', 'prompt', label='interactive\nelements')
dot.edge('readability', 'prompt', label='clean text')
dot.edge('context', 'prompt', label='metadata')
dot.edge('find', 'prompt', label='[12] Button\n[13] Input')

dot.render('agent_perception', format='png', cleanup=True)
print("✅ agent_perception.png")
