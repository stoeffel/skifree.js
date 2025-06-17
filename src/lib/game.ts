import * as Vec2 from 'lib/vec2'
import * as Canvas from 'canvas'
import * as Random from 'lib/random'
import * as Convergence from 'lib/convergence'
import { config } from 'config'
import { Skier } from 'lib/skier'
import { Monster } from 'lib/monster'
import { Sprite, hitBoxToCanvas, projectX, projectY } from 'lib/sprite'
import { spriteInfo } from 'spriteInfo'
import { Snowboarder } from 'lib/snowboarder'

export function Game (mainCanvas: HTMLCanvasElement, skier: Skier) {
  const afterCycleCallbacks: Array<any> = []

  let sprites = new Array<Sprite>()
  let paused = false
  let runningTime = 0
  let zoom = config.zoom.max

  this.addObject = (sprite: Sprite) => {
    sprites.push(sprite)
  }

  this.canAddObject = (candidate: Sprite) => {
    // Determine graphical properties to enable hit check
    if (candidate.data.parts.main !== undefined) {
      candidate.determineNextFrame('main')
    }

    return !sprites.some((existing: Sprite) => {
      if (existing.hits({ sprite: candidate, forPlacement: true })) {
        return true
      } else {
        const jumpsTakenIds = skier.jumps.map(j => j.spriteId)
        return existing.hitsLandingArea(candidate, jumpsTakenIds)
      }
    })
  }

  this.addObjects = (sprites: Array<Sprite>) => {
    sprites.forEach((sprite: Sprite) => this.addObject(sprite))
  }

  this.afterCycle = (callback: any) => {
    afterCycleCallbacks.push(callback)
  }

  this.cycle = (dt: number) => {
    if (!paused) {
      this.addObjects(createObjects(sprites, dt, skier, this.canAddObject))

      const canSpawnBoarder = skier.downhillMetersTravelled() > config.snowboarder.spawnAfterMetersTravelled

      randomlySpawnNPC(skier, this.spawnBoarder, config.dropRate.npc.snowboarder)

      const lastJump = skier.lastJump()

      // When jumping or landing, skier speed is temporarily higher, this make
      // the monster to go too fast on the player when the skier decerelates.
      const isJumpingOrLanding = lastJump !== undefined
        ? skier.pos.y < lastJump.y + config.jump.length(Canvas.height) + config.jump.landingHeight(Canvas.height)
        : false

      const canSpawnMonster = (
        skier.downhillMetersTravelled() > config.monster.spawnAfterMetersTravelled
        && !this.hasObject('monster')
        && !isJumpingOrLanding)

      if (canSpawnMonster) {
        randomlySpawnNPC(skier, this.spawnMonster, config.dropRate.npc.monster)
      }

      skier.cycle(runningTime, dt)

      sprites.forEach((sprite: Sprite, i: number) => {
        if (sprite.canBeDeleted(skier.pos)) {
          delete sprites[i]
        } else {
          sprite.cycle(runningTime, dt)
        }
      })
    }

    // Check collisions
    sprites.forEach((sprite: Sprite) => {
      if (skier.hits({ sprite, forPlacement: false })) {
        const n = sprite.data.name
        if (n === 'smallTree' || n === 'tallTree' || n === 'rock' || n === 'snowboarder') {
          skier.hitObstacle(runningTime, sprite)
        } else if (n === 'monster') {
          monsterEatsSkier(runningTime, sprite as Monster, skier)
        } else if (n === 'jump') {
          skier.hitJump(runningTime, sprite)
        }
      }
    })

    zoom = Convergence.converge({
      from: zoom,
      to: Math.max(1, config.zoom.max - skier.confidenceBoost * (config.zoom.max - config.zoom.min)),
      time: config.zoom.convergenceDuration,
      dt
    })

    afterCycleCallbacks.forEach((c: any) => c())
  }

  this.spawnBoarder = () => {
    const newBoarder = new Snowboarder(skier, spriteInfo.snowboarder)

    const { x, y } = Random.bool()
      ? Canvas.getRandomMapPositionAboveViewport(skier.pos)
      : Canvas.getRandomMapPositionBelowViewport(skier.pos)
    newBoarder.pos = { x, y }

    newBoarder.movingToward = Canvas.getRandomMapPositionBelowViewport(skier.pos)

    this.addObject(newBoarder)
  }

  this.spawnMonster = () => {
    const monster = new Monster(runningTime, spriteInfo.monster, skier)
    monster.pos = {
      x: skier.pos.x,
      y: Canvas.canvasPositionToMapPosition(skier.pos, { x: 0, y: -monster.height }).y
    }
    monster.movingTowardSpeed = Vec2.length(skier.speed)
    monster.follow(skier)
    this.addObject(monster)
  }

  this.draw = () => {
    Canvas.context.clearRect(0, 0, mainCanvas.width, mainCanvas.height)

    const allSprites = sprites.slice() // Clone
    allSprites.push(skier)
    allSprites.sort(sortFromBackToFront)
    allSprites.forEach((object: Sprite) => object.draw(runningTime, skier.pos, 'main', zoom))

    if (config.debug) {
      this.drawDebug(allSprites)
    }
  }

  this.drawDebug = (allSprites: Array<Sprite>) => {
    Canvas.context.fillText(`confidence boost: ${skier.confidenceBoost.toFixed(2)}`, Canvas.width * 0.02, Canvas.height * 0.20)
    Canvas.context.fillText(`speed: ${Vec2.length(skier.speed).toFixed(2)}`, Canvas.width * 0.02, Canvas.height * 0.22)
    Canvas.context.fillText(`zoom: ${zoom.toFixed(2)}`, Canvas.width * 0.02, Canvas.height * 0.24)
    Canvas.context.fillText(`distance travelled: ${skier.downhillMetersTravelled().toFixed(2)}`, Canvas.width * 0.02, Canvas.height * 0.26)

    allSprites.forEach(sprite => {
      // Hitbox
      sprite.getHitBoxes().forEach(h => {
        const ch = hitBoxToCanvas(skier.pos, h)
        Canvas.context.beginPath()
        Canvas.context.strokeStyle = 'red'
        Canvas.context.rect(
          projectX(zoom, ch.left),
          projectY(zoom, ch.bottom),
          (ch.right - ch.left) * zoom,
          (ch.top - ch.bottom) * zoom)
        Canvas.context.stroke()
      })

      // Landing area
      const jumpsTakenIds = skier.jumps.map(j => j.spriteId)
      let lhb = sprite.landingHitBox(jumpsTakenIds)
      if (lhb !== undefined) {
        lhb = hitBoxToCanvas(skier.pos, lhb)
        Canvas.context.beginPath()
        Canvas.context.strokeStyle = 'green'
        Canvas.context.rect(
          projectX(zoom, lhb.left),
          projectY(zoom, lhb.bottom),
          (lhb.right - lhb.left) * zoom,
          (lhb.top - lhb.bottom) * zoom)
        Canvas.context.stroke()
      }
    })
  }

  this.start = () => {
    this.loop()
  }

  this.pause = () => {
    paused = true
  }

  this.resume = () => {
    paused = false 
    this.loop()
  }

  this.isPaused = () => {
    return paused
  }

  this.getRunningTime = () => {
    return runningTime
  }

  this.reset = () => {
    paused = false
    sprites = new Array<Sprite>()
    this.start()
    runningTime = 0
  }

  this.step = (lastStepAt: number, now: number) => {
    if (paused) return;

    let dt = now - lastStepAt
    runningTime += dt

    this.cycle(dt)
    this.draw()
    this.loop(now)
  }
  
  this.loop = (lastStepAt: number | undefined) => {
    requestAnimationFrame(now => this.step(lastStepAt || now, now))
  }
  
  this.hasObject = (name: string) => {
    return sprites.some((obj: Sprite) => {
      return obj.data.name === name
    })
  }
}

function sortFromBackToFront(a: Sprite, b: Sprite): number {
  if (isJumpingSkier(a)) {
    return 1
  } else if (isJumpingSkier(b)) {
    return -1
  } else if (isSnow(a)) {
    return -1
  } else if (isSnow(b)) {
    return 1
  } else {
    const aBottom = a.pos.y + a.height
    const bBottom = b.pos.y + b.height
    return aBottom - bBottom
  }
}

function isJumpingSkier(sprite: any) {
  return sprite.data.name === 'skier' && sprite.isJumping()
}

function isSnow(sprite: Sprite) {
  return sprite.data.name === 'thickSnow' || sprite.data.name === 'thickerSnow'
}

const spawnableSprites = [
  { sprite: spriteInfo.smallTree, dropRate: config.dropRate.smallTree },
  { sprite: spriteInfo.tallTree, dropRate: config.dropRate.tallTree },
  { sprite: spriteInfo.thickSnow, dropRate: config.dropRate.thickSnow },
  { sprite: spriteInfo.thickerSnow, dropRate: config.dropRate.thickerSnow },
  { sprite: spriteInfo.rock, dropRate: config.dropRate.rock },
  { sprite: spriteInfo.jump, dropRate: config.dropRate.jump },
]

function createObjects(sprites: Array<Sprite>, dt: number, skier: Skier, canAddObject: (sprite: any) => boolean) {
  const dropRateFactor = 150 * skier.speed.y * dt / Canvas.diagonal

  const sideTrees = [ Canvas.getRandomSideMapPositionBelowViewport(skier.pos) ]
    .filter(_ => {
      const random = Random.float({ min: 0, max: 100 })
      return random < dropRateFactor * config.dropRate.side.tallTree
    })
    .map(pos => {
      const sprite = new Sprite(spriteInfo.tallTree)
      sprite.pos = pos
      return sprite
    })

  const skierDirectionObjects = [ undefined ]
    .filter(_ => {
      const random = Random.float({ min: 0, max: 100 })
      return skier.speed !== Vec2.zero && random < dropRateFactor * config.dropRate.skierDirection.any
    })
    .map(_ => {
      const sprite = new Sprite(randomObstacle())
      const { y } = Canvas.getRandomMapPositionBelowViewport(skier.pos)
      const x = skier.pos.x + skier.speed.x / skier.speed.y * (y - skier.pos.y)
      sprite.pos = { x, y }
      return sprite
    })

  const centeredObjects = spawnableSprites
    .filter((spriteInfo: any) => {
      const random = Random.float({ min: 0, max: 100 })
      return random < dropRateFactor * spriteInfo.dropRate
    })
    .map((spriteInfo: any) => {
      const sprite = new Sprite(spriteInfo.sprite)
      sprite.pos = Canvas.getRandomMapPositionBelowViewport(skier.pos)
      return sprite
    })

  return sideTrees
    .concat(skierDirectionObjects)
    .concat(centeredObjects)
    .filter(sprite => canAddObject(sprite))
}

function randomObstacle() {
  const r = Random.int({ min: 1, max: 3 })
  if (r == 1) {
    return spriteInfo.tallTree
  } else if (r == 2) {
    return spriteInfo.smallTree
  } else {
    return spriteInfo.rock
  }
}

function randomlySpawnNPC(skier: Skier, spawnFunction: () => void, dropRate: number) {
  if (Random.float({ min: 0, max: 100 }) < dropRate * skier.speed.y * 2000 / Canvas.diagonal) {
    spawnFunction()
  }
}

function monsterEatsSkier(time: number, monster: Monster, skier: Skier) {
  if (monster.eatingStartedAt === undefined) {
    skier.setEaten(time)
    monster.stopFollowing()
    monster.startEating({ whenDone: () => monster.moveAbove() })

    // @ts-ignore
    window.PlayEGI.motor('negative')
  }
}
