import React, { useRef, useEffect, useCallback } from 'react'
import { gsap } from 'gsap'
import { cn } from '../lib/utils'

interface WaveformProps {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'tool' | 'warming' | 'summarizing'
  className?: string
  onClick?: () => void
}

const getWaveConfig = (state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'tool' | 'warming' | 'summarizing') => ({
  barCount: 80,
  barWidth: 4,
  barSpacing: 2,
  maxHeight: state === 'listening' ? 120 : state === 'speaking' ? 100 : state === 'warming' ? 80 : state === 'thinking' ? 70 : state === 'tool' ? 90 : state === 'summarizing' ? 85 : 40,
  baseHeight: 4,
  colorStops: state === 'listening'
    ? [
        { stop: 0, color: [239, 68, 68] },    // Red 500
        { stop: 0.3, color: [220, 38, 38] },  // Red 600
        { stop: 0.6, color: [185, 28, 28] },  // Red 700
        { stop: 1, color: [153, 27, 27] }     // Red 800
      ]
    : state === 'speaking'
    ? [
        { stop: 0, color: [34, 197, 94] },    // Green 500
        { stop: 0.3, color: [22, 163, 74] },  // Green 600
        { stop: 0.6, color: [21, 128, 61] },  // Green 700
        { stop: 1, color: [22, 101, 52] }     // Green 800
      ]
    : state === 'warming'
    ? [
        { stop: 0, color: [251, 146, 60] },   // Orange 400
        { stop: 0.3, color: [249, 115, 22] }, // Orange 500
        { stop: 0.6, color: [234, 88, 12] },  // Orange 600
        { stop: 1, color: [194, 65, 12] }     // Orange 700
      ]
    : state === 'thinking'
    ? [
        { stop: 0, color: [59, 130, 246] },   // Blue 500
        { stop: 0.3, color: [37, 99, 235] },  // Blue 600
        { stop: 0.6, color: [29, 78, 216] },  // Blue 700
        { stop: 1, color: [30, 64, 175] }     // Blue 800
      ]
    : state === 'tool'
    ? [
        { stop: 0, color: [168, 85, 247] },   // Purple 500
        { stop: 0.3, color: [147, 51, 234] }, // Purple 600
        { stop: 0.6, color: [126, 34, 206] }, // Purple 700
        { stop: 1, color: [107, 33, 168] }    // Purple 800
      ]
    : state === 'summarizing'
    ? [
        { stop: 0, color: [251, 191, 36] },   // Amber 400
        { stop: 0.3, color: [245, 158, 11] }, // Amber 500
        { stop: 0.6, color: [217, 119, 6] },  // Amber 600
        { stop: 1, color: [180, 83, 9] }      // Amber 700
      ]
    : [
        { stop: 0, color: [75, 85, 99] },     // Gray 600
        { stop: 0.3, color: [55, 65, 81] },   // Gray 700
        { stop: 0.6, color: [55, 65, 81] },   // Gray 700
        { stop: 1, color: [75, 85, 99] }      // Gray 600
      ]
})

export function Waveform({ state, className, onClick }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | undefined>(undefined)
  const animatedHeights = useRef<{ [key: number]: number }>({})
  const animatedCenterBarHeight = useRef<{ height: number }>({ height: 0 })

  const interpolateColor = (color1: number[], color2: number[], factor: number): number[] => {
    return [
      Math.round(color1[0] + (color2[0] - color1[0]) * factor),
      Math.round(color1[1] + (color2[1] - color1[1]) * factor),
      Math.round(color1[2] + (color2[2] - color1[2]) * factor)
    ]
  }

  const getColorAtPosition = (position: number): string => {
    const waveConfig = getWaveConfig(state)
    const { colorStops } = waveConfig

    for (let i = 0; i < colorStops.length - 1; i++) {
      const current = colorStops[i]
      const next = colorStops[i + 1]

      if (position >= current.stop && position <= next.stop) {
        const localPosition = (position - current.stop) / (next.stop - current.stop)
        const color = interpolateColor(current.color, next.color, localPosition)
        return `rgb(${color[0]}, ${color[1]}, ${color[2]})`
      }
    }

    return `rgb(${colorStops[0].color[0]}, ${colorStops[0].color[1]}, ${colorStops[0].color[2]})`
  }

  const animate = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas
    const centerY = height / 2
    const waveConfig = getWaveConfig(state)
    const { barCount, barWidth, barSpacing, maxHeight, baseHeight } = waveConfig

    ctx.clearRect(0, 0, width, height)

    const totalBarWidth = barCount * barWidth + (barCount - 1) * barSpacing
    const halfBarCount = Math.floor(barCount / 2)
    const centerX = width / 2

    for (let i = 0; i < halfBarCount; i++) {
      let targetBarHeight = baseHeight

      if (state === 'listening') {
        const time = Date.now() * 0.003
        const wave = Math.sin(time + i * 0.3) * 0.5 + 0.5
        targetBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'speaking') {
        const time = Date.now() * 0.005
        const wave = Math.sin(time + i * 0.4) * 0.6 + 0.4
        targetBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'warming') {
        const time = Date.now() * 0.002
        const wave = Math.sin(time + i * 0.25) * 0.5 + 0.5
        targetBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'thinking') {
        const time = Date.now() * 0.004
        const wave = Math.sin(time + i * 0.2) * 0.4 + 0.6
        targetBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'tool') {
        const time = Date.now() * 0.006
        const wave = Math.sin(time + i * 0.5) * 0.7 + 0.3
        targetBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'summarizing') {
        const time = Date.now() * 0.0025
        const wave1 = Math.sin(time + i * 0.15) * 0.5 + 0.5
        const wave2 = Math.sin(time * 1.3 + i * 0.1) * 0.3 + 0.7
        targetBarHeight = baseHeight + wave1 * wave2 * maxHeight
      } else {
        const time = Date.now() * 0.001
        const wave = Math.sin(time + i * 0.2) * 0.3 + 0.7
        targetBarHeight = baseHeight + wave * 20
      }

      if (animatedHeights.current[i] === undefined) {
        animatedHeights.current[i] = baseHeight
      }
      gsap.to(animatedHeights.current, { [i]: targetBarHeight, duration: 0.2, ease: 'power2.out' })
      const barHeight = animatedHeights.current[i]

      const offsetFromCenter = i * (barWidth + barSpacing) + barSpacing
      const leftX = centerX - offsetFromCenter - barWidth
      const rightX = centerX + offsetFromCenter

      const position = i / (halfBarCount - 1)
      const color = getColorAtPosition(position)

      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = state === 'idle' ? 4 : 8
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0

      const barY = centerY - barHeight / 2
      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(leftX, barY, barWidth, barHeight, barWidth / 2)
      } else {
        ctx.rect(leftX, barY, barWidth, barHeight)
      }
      ctx.fill()

      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(rightX, barY, barWidth, barHeight, barWidth / 2)
      } else {
        ctx.rect(rightX, barY, barWidth, barHeight)
      }
      ctx.fill()

      ctx.shadowBlur = 0
    }

    if (barCount % 2 === 1) {
      let targetCenterBarHeight = baseHeight

      if (state === 'listening') {
        const time = Date.now() * 0.003
        const wave = Math.sin(time) * 0.5 + 0.5
        targetCenterBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'speaking') {
        const time = Date.now() * 0.005
        const wave = Math.sin(time) * 0.6 + 0.4
        targetCenterBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'warming') {
        const time = Date.now() * 0.002
        const wave = Math.sin(time) * 0.5 + 0.5
        targetCenterBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'thinking') {
        const time = Date.now() * 0.004
        const wave = Math.sin(time) * 0.4 + 0.6
        targetCenterBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'tool') {
        const time = Date.now() * 0.006
        const wave = Math.sin(time) * 0.7 + 0.3
        targetCenterBarHeight = baseHeight + wave * maxHeight
      } else if (state === 'summarizing') {
        const time = Date.now() * 0.0025
        const wave1 = Math.sin(time) * 0.5 + 0.5
        const wave2 = Math.sin(time * 1.3) * 0.3 + 0.7
        targetCenterBarHeight = baseHeight + wave1 * wave2 * maxHeight
      } else {
        const time = Date.now() * 0.001
        const wave = Math.sin(time) * 0.3 + 0.7
        targetCenterBarHeight = baseHeight + wave * 20
      }

      gsap.to(animatedCenterBarHeight.current, { height: targetCenterBarHeight, duration: 0.2, ease: 'power2.out' })
      const centerBarHeight = animatedCenterBarHeight.current.height

      const centerColor = getColorAtPosition(0.5)
      ctx.fillStyle = centerColor
      ctx.shadowColor = centerColor
      ctx.shadowBlur = state === 'idle' ? 4 : 8

      const centerBarY = centerY - centerBarHeight / 2
      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(centerX - barWidth / 2, centerBarY, barWidth, centerBarHeight, barWidth / 2)
      } else {
        ctx.rect(centerX - barWidth / 2, centerBarY, barWidth, centerBarHeight)
      }
      ctx.fill()
      ctx.shadowBlur = 0
    }

    animationRef.current = requestAnimationFrame(animate)
  }, [state])

  useEffect(() => {
    animate()
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [animate])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={cn(className || "w-full h-32", onClick ? 'cursor-pointer' : '')}
      style={{ width: '100%', height: '128px' }}
      onClick={onClick}
    />
  )
}

