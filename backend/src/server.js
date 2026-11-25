import express from 'express'

const app = express()
const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 3001)

app.get('/api/v1/health', (_request, response) => {
  response.json({ status: 'ok' })
})

const server = app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${server.address().port}`)
})
