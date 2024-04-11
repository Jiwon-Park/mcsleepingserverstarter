
import { GetDomainCommand, UpdateDomainEntryCommand, LightsailClient } from "@aws-sdk/client-lightsail";

async function foo() {
    const LSclient = new LightsailClient({ region: "us-east-1" })
    const getDomain = new GetDomainCommand({
        domainName: "seni.kr"
    })
    const resp = await LSclient.send(getDomain)
    //find matching domainEntry from req.body.hostname
    if(resp.domain?.domainEntries) {
        const domainEntry = resp.domain.domainEntries.find((entry) => entry.name == "craft.seni.kr")
        console.log(domainEntry)
        if(domainEntry) {
        const updateDomain = new UpdateDomainEntryCommand({
            domainName: "seni.kr",
            domainEntry: {
                id: domainEntry.id,
                name: domainEntry.name,
                target: '1.1.1.1',
                type: domainEntry.type
            }
        })
        await LSclient.send(updateDomain)
        console.log("Domain entry updated")
        }
        else {
        console.log("No matching domain entry")
        }
    }
    else {
        console.log("No domain entry")
    }
}

foo()