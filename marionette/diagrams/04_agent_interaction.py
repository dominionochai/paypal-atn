#!/usr/bin/env python3
"""
Agent Interaction - How the agent acts on the webpage
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('Interaction', comment='Agent Interaction')
dot.attr(rankdir='TB', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', nodesep='0.8', ranksep='1.0',
         splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# Top: Agent decision
dot.node('agent', 'Prompt API\nDecision', fillcolor='#ffcdd2', 
         width='2.5', fontsize='15', penwidth='3')

# Tool calls
with dot.subgraph() as s:
    s.attr(rank='same')
    s.node('click', 'clickElement', fillcolor='#bbdefb')
    s.node('fill', 'fillInput', fillcolor='#bbdefb')
    s.node('scroll', 'scrollUp/Down', fillcolor='#bbdefb')
    s.node('press', 'pressKey', fillcolor='#bbdefb')

# Content script layer
dot.node('content', 'Content Script\n(Injected)', fillcolor='#e1bee7',
         width='2.5')

# DOM actions
with dot.subgraph() as s:
    s.attr(rank='same')
    s.node('dom_click', 'element.click()', fillcolor='#e8f5e9', 
           fontsize='12', shape='note')
    s.node('dom_fill', 'element.value = X', fillcolor='#e8f5e9',
           fontsize='12', shape='note')
    s.node('dom_scroll', 'window.scrollBy()', fillcolor='#e8f5e9',
           fontsize='12', shape='note')
    s.node('dom_key', 'keydown event', fillcolor='#e8f5e9',
           fontsize='12', shape='note')

# Bottom: Webpage
dot.node('page', 'Webpage DOM\n(Modified)', fillcolor='#c8e6c9', 
         width='3', fontsize='15', penwidth='3')

# Connections
dot.edge('agent', 'click', label='tool call')
dot.edge('agent', 'fill', label='tool call')
dot.edge('agent', 'scroll', label='tool call')
dot.edge('agent', 'press', label='tool call')

dot.edge('click', 'content', label='index: 12')
dot.edge('fill', 'content', label='index: 13\nvalue: "text"')
dot.edge('scroll', 'content')
dot.edge('press', 'content', label='key: "Enter"')

dot.edge('content', 'dom_click')
dot.edge('content', 'dom_fill')
dot.edge('content', 'dom_scroll')
dot.edge('content', 'dom_key')

dot.edge('dom_click', 'page')
dot.edge('dom_fill', 'page')
dot.edge('dom_scroll', 'page')
dot.edge('dom_key', 'page')

dot.render('agent_interaction', format='png', cleanup=True)
print("✅ agent_interaction.png")
