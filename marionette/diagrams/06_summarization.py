#!/usr/bin/env python3
"""
Summarization Flow - Context window management
Hand-drawn style
"""

from graphviz import Digraph

dot = Digraph('Summarization', comment='Context Summarization')
dot.attr(rankdir='TB', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#2c3e50', dpi='300', nodesep='0.8', ranksep='1.0',
         splines='curved')
dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2',
         fillcolor='#fffef7', color='#2c3e50')
dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# Context grows
dot.node('context', 'Context Window\n7,300 / 9,216 tokens\n(80% full)', 
         fillcolor='#ffcdd2', width='2.5', penwidth='3', fontsize='14')

# Trigger
dot.node('trigger', 'Threshold\nReached', fillcolor='#ffcdd2',
         width='2')

# Summarizer
dot.node('summarizer', 'Summarizer API', fillcolor='#bbdefb', width='2.5')

# Prompt
dot.node('prompt', 'Tuned Prompt\n\n• Preserve task state\n• Keep field indices\n• Retain user data\n• Next action', 
         fillcolor='#e1bee7', shape='note', fontsize='11', width='2.5')

# Summary
dot.node('summary', 'Compressed\nSummary\n~1,200 tokens', 
         fillcolor='#c8e6c9', width='2.5')

# Replace
dot.node('replace', 'Replace History\nMark Old as\nVisual-Only', 
         fillcolor='#c8e6c9', width='2.5')

# Continue
dot.node('continue', 'Agent Continues\nwith Task', fillcolor='#c8e6c9',
         width='2.5')

# New context state
dot.node('new_context', 'Context Window\n1,500 / 9,216 tokens\n(16% full)', 
         fillcolor='#c8e6c9', width='2.5', penwidth='3', fontsize='14')

# Flow
dot.edge('context', 'trigger')
dot.edge('trigger', 'summarizer')
dot.edge('prompt', 'summarizer', style='dotted', label='guides')
dot.edge('summarizer', 'summary', label='generate')
dot.edge('summary', 'replace')
dot.edge('replace', 'new_context')
dot.edge('new_context', 'continue')

dot.render('summarization', format='png', cleanup=True)
print("✅ summarization.png")
