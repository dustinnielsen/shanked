import dynamic from 'next/dynamic'

const GolfRoastMachine = dynamic(() => import('./GolfRoastMachine'), {
  ssr: false
})

export default function Home() {
  return <GolfRoastMachine />
}
