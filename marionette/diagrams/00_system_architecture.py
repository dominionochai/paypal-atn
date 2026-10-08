#!/usr/bin/env python3
"""
Marionette System Architecture
Hand-drawn style diagram using Graphviz sketch mode.
"""

from graphviz import Digraph

dot = Digraph('Architecture', comment='System Architecture')

# Hand-drawn sketch style
dot.attr(rankdir='TB', bgcolor='white', fontname='Comic Sans MS', 
         fontcolor='#000000', dpi='300', splines='curved',
         nodesep='1.0', ranksep='1.2', pad='0.5')

# Enable sketch/hand-drawn mode
dot.graph_attr['style'] = 'rounded'

dot.attr('node', shape='box', style='rounded,filled', fontname='Comic Sans MS', 
         fontsize='13', penwidth='2', margin='0.3,0.2', 
         fillcolor='#fffef7', color='#2c3e50')

dot.attr('edge', fontname='Comic Sans MS', fontsize='11', 
         fontcolor='#2c3e50', penwidth='2', color='#2c3e50')

# === MULTIMODAL INPUT ===
with dot.subgraph(name='cluster_input') as c:
    c.attr(label='MULTIMODAL INPUT', style='rounded,filled',
           fillcolor='#f0f4f8', color='#2c3e50', 
           fontsize='14', penwidth='2.5', margin='20')
    c.node('text', 'Text')
    c.node('voice', 'Voice')
    c.node('image', 'Image')
    c.node('audio', 'Audio')

# === AGENT CORE ===
dot.node('system_prompt', 'System Prompt\n\nTools + Context\n+ Memories',
         fillcolor='#e3f2fd', shape='note')
dot.node('prompt_api', 'PROMPT API\n━━━━━━━━━\nGemini Nano\n9,216 tokens', 
         fillcolor='#bbdefb', penwidth='3', fontsize='15', width='3')
dot.node('parser', 'Parser', fillcolor='#e3f2fd')
dot.node('summarizer', 'Summarizer\n\n80% Context Trigger', fillcolor='#e3f2fd')

# === WEB INTERFACE ===
with dot.subgraph(name='cluster_web') as c:
    c.attr(label='WEB INTERFACE', style='rounded,filled',
           fillcolor='#e8f5e9', color='#2c3e50', 
           fontsize='14', penwidth='2.5', margin='20')
    c.node('screenshot', 'Screenshot', fillcolor='#c8e6c9')
    c.node('a11y', 'Accessibility\nTree', fillcolor='#c8e6c9')
    c.node('readability', 'Readability', fillcolor='#c8e6c9')
    c.node('click', 'Click Element', fillcolor='#c8e6c9')
    c.node('fill', 'Fill Input', fillcolor='#c8e6c9')

# === EXECUTION LAYER ===
with dot.subgraph(name='cluster_exec') as c:
    c.attr(label='EXECUTION LAYER', style='rounded,filled',
           fillcolor='#f3e5f5', color='#2c3e50', 
           fontsize='14', penwidth='2.5', margin='20')
    c.node('router', 'Tool Router', fillcolor='#ce93d8', 
           shape='diamond', width='2', fontsize='14')
    c.node('bg_handler', 'Background\nHandler', fillcolor='#e1bee7')
    c.node('ui_handler', 'UI Context\nHandler', fillcolor='#e1bee7')
    c.node('content_script', 'Content Script', fillcolor='#e1bee7')

# === MEMORY SYSTEMS ===
with dot.subgraph(name='cluster_agent_mem') as c:
    c.attr(label='AGENT MEMORY', style='rounded,filled',
           fillcolor='#fff3e0', color='#2c3e50', 
           fontsize='14', penwidth='2.5', margin='20')
    c.node('store_mem', 'Store\nMemory', fillcolor='#ffe0b2')
    c.node('chrome_storage', 'Chrome\nStorage', fillcolor='#ffcc80', 
           shape='cylinder')
    c.node('get_mem', 'Get\nMemories', fillcolor='#ffe0b2')

with dot.subgraph(name='cluster_vault') as c:
    c.attr(label='SEMANTIC VAULT', style='rounded,filled',
           fillcolor='#fce4ec', color='#2c3e50', 
           fontsize='14', penwidth='2.5', margin='20')
    c.node('transformers', 'Transformers.js\n384D Embeddings', 
           fillcolor='#f8bbd0')
    c.node('indexeddb', 'IndexedDB', fillcolor='#f48fb1', 
           shape='cylinder')
    c.node('search_vault', 'Search\nVault', fillcolor='#f8bbd0')

# === PLAYBOOKS & SPECIAL NODES ===
dot.node('playbooks', 'Playbooks\n\nOn-demand\nGuides', 
         fillcolor='#e1f5fe', shape='note')
dot.node('get_playbook', 'Get Playbook', fillcolor='#b3e5fc')

dot.node('tool_result', 'TOOL RESULT', fillcolor='#ffcdd2', 
         penwidth='4', fontsize='16', width='2.5', color='#c62828')

# === MAIN FLOW ===

# Inputs to agent
for inp in ['text', 'voice', 'image', 'audio']:
    dot.edge(inp, 'prompt_api', penwidth='2')

# System prompt
dot.edge('system_prompt', 'prompt_api', label='initialize', 
         style='dashed', penwidth='2')

# Agent flow
dot.edge('prompt_api', 'parser', label='stream', penwidth='3', 
         color='#1976d2')
dot.edge('parser', 'router', label='function_call', penwidth='3')

# Router to handlers
dot.edge('router', 'bg_handler', penwidth='2')
dot.edge('router', 'ui_handler', label='user gesture', 
         style='dashed', penwidth='2')
dot.edge('router', 'content_script', label='page inject', 
         style='dashed', penwidth='2')

# Handlers to result
dot.edge('bg_handler', 'tool_result', penwidth='2')
dot.edge('ui_handler', 'tool_result', penwidth='2')
dot.edge('content_script', 'tool_result', penwidth='2')

# CRITICAL LOOPBACK
dot.edge('tool_result', 'prompt_api', label='LOOPBACK', 
         color='#c62828', penwidth='5', fontsize='13')

# Web interface
dot.edge('screenshot', 'prompt_api', label='visual', style='dotted', penwidth='2')
dot.edge('a11y', 'router', label='structure', style='dotted', penwidth='2')
dot.edge('readability', 'router', label='content', style='dotted', penwidth='2')
dot.edge('content_script', 'click', penwidth='2')
dot.edge('content_script', 'fill', penwidth='2')

# Playbooks
dot.edge('router', 'get_playbook', label='request', style='dotted', penwidth='2')
dot.edge('get_playbook', 'playbooks', penwidth='2')
dot.edge('playbooks', 'tool_result', label='guidance', style='dashed', penwidth='2')

# Agent memory
dot.edge('router', 'store_mem', style='dotted', penwidth='2')
dot.edge('store_mem', 'chrome_storage', penwidth='2')
dot.edge('chrome_storage', 'system_prompt', label='load', style='dashed', penwidth='2')
dot.edge('router', 'get_mem', style='dotted', penwidth='2')
dot.edge('get_mem', 'chrome_storage', style='dashed', penwidth='2')
dot.edge('get_mem', 'tool_result', style='dotted', penwidth='2')

# Semantic vault
dot.edge('readability', 'transformers', label='text', penwidth='2')
dot.edge('transformers', 'indexeddb', label='embed', penwidth='2')
dot.edge('router', 'search_vault', style='dotted', penwidth='2')
dot.edge('search_vault', 'transformers', label='query', style='dashed', penwidth='2')
dot.edge('indexeddb', 'search_vault', penwidth='2')
dot.edge('search_vault', 'tool_result', style='dotted', penwidth='2')

# Summarizer
dot.edge('summarizer', 'prompt_api', label='compress', style='dashed', penwidth='2')

# Completion path
dot.edge('parser', 'tool_result', label='done', style='dashed', 
         constraint='false', penwidth='2')

dot.render('system_architecture', format='png', cleanup=True)
print("✅ system_architecture.png")
