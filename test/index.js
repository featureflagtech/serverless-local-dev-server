'use strict'

/* global describe it beforeEach afterEach */
const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const fetch = require('node-fetch')
const sinon = require('sinon')
const Serverless = require('serverless/lib/Serverless')
const AwsProvider = require('serverless/lib/plugins/aws/provider/awsProvider')
const AlexaDevServer = require('../src')

chai.use(chaiAsPromised)
const expect = chai.expect

describe('index.js', () => {
  let sandbox, serverless, alexaDevServer

  const sendAlexaRequest = (port, name) => {
    return fetch(`http://localhost:${port}/alexa-skill/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: '{"session":{},"request":{},"version":"1.0"}'
    })
  }

  const sendHttpGetRequest = (port, path) => {
    return fetch(`http://localhost:${port}/http/${path}`)
  }

  const sendHttpPostRequest = (port, path) => {
    return fetch(`http://localhost:${port}/http/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: '{"foo":"bar"}'
    })
  }

  beforeEach(() => {
    sandbox = sinon.sandbox.create()
    serverless = new Serverless()
    serverless.init()
    serverless.setProvider('aws', new AwsProvider(serverless))
    serverless.config.servicePath = __dirname
  })

  afterEach((done) => {
    sandbox.restore()
    done()
  })

  it('should have hooks', () => {
    alexaDevServer = new AlexaDevServer(serverless)
    expect(Object.keys(alexaDevServer.hooks).length).to.not.equal(0)
  })

  it('should start a server and accept various requests', () => {
    serverless.service.functions = {
      'MyAlexaSkill': {
        handler: 'lambda-handler.alexaSkill',
        events: [ 'alexaSkill' ]
      },
      'MyHttpResource': {
        handler: 'lambda-handler.httpGet',
        events: [ { http: { method: 'GET', path: '/foo' } } ]
      },
      'MyHttpResourceID': {
        handler: 'lambda-handler.httpGet',
        events: [ { http: { method: 'GET', path: '/foo/{id}' } } ]
      },
      'MyShorthandHttpResource': {
        handler: 'lambda-handler.httpPost',
        events: [ { http: 'POST shorthand' } ]
      }
    }
    alexaDevServer = new AlexaDevServer(serverless)
    alexaDevServer.hooks['local-dev-server:loadEnvVars']()
    alexaDevServer.hooks['local-dev-server:start']()
    return Promise.all([
      sendAlexaRequest(5005, 'MyAlexaSkill').then(result =>
        expect(result.ok).equal(true)
      ),
      sendHttpGetRequest(5005, 'foo?a=b&c=d').then(result => {
        expect(result.status).equal(200)
        return result.json().then(json => {
          expect(json.queryStringParameters.a).equal('b')
          expect(json.queryStringParameters.c).equal('d')
          expect(json.pathParameters).eql({})
          expect(json.path).eql('/foo')
          expect(json.resource).eql('/foo')
        })
      }),
      sendHttpGetRequest(5005, 'foo/12345').then(result => {
        expect(result.status).equal(200)
        return result.json().then(json => {
          expect(json.pathParameters.id).eql('12345')
          expect(json.resource).eql('/foo/{id}')
          expect(json.path).eql('/foo/12345')
        })
      }),
      sendHttpPostRequest(5005, 'shorthand', {}).then(result => {
        expect(result.status).equal(204)
      })
    ])
  })

  it('should start a server with a custom port and accept requests', () => {
    serverless.service.functions = {
      'MyHttpResource': {
        handler: 'lambda-handler.httpGet',
        events: [ { http: 'GET /' } ]
      }
    }
    alexaDevServer = new AlexaDevServer(serverless, { port: 5006 })
    alexaDevServer.hooks['local-dev-server:loadEnvVars']()
    alexaDevServer.hooks['local-dev-server:start']()
    return sendHttpGetRequest(5006, '').then(result =>
      expect(result.ok).equal(true)
    )
  })

  it('should set environment variables correctly', () => {
    serverless.service.provider.environment = {
      foo: 'bar',
      bla: 'blub',
      la: 'la'
    }
    serverless.service.functions = {
      'MyAlexaSkill': {
        handler: 'lambda-handler.mirrorEnv',
        events: [ 'alexaSkill' ],
        environment: {
          foo: 'baz'
        }
      }
    }
    let options = {
      environment: { la: 'lala' },
      port: 5007
    }
    alexaDevServer = new AlexaDevServer(serverless, options)
    alexaDevServer.hooks['local-dev-server:loadEnvVars']()
    alexaDevServer.hooks['local-dev-server:start']()
    return sendAlexaRequest(5007, 'MyAlexaSkill').then(result => {
      expect(result.ok).equal(true)
      return result.json()
    }).then(json => {
      expect(json.IS_LOCAL).equal(true)
      expect(json.foo).equal('baz')
      expect(json.bla).equal('blub')
      expect(json.la).equal('lala')
    })
  })

  it('should not start a server if no supported events are specified', () => {
    serverless.service.functions = {
      'SomeFunction': {
        handler: 'lambda-handler.none',
        events: [ 'blub' ]
      }
    }
    alexaDevServer = new AlexaDevServer(serverless, { port: 5008 })
    alexaDevServer.hooks['local-dev-server:loadEnvVars']()
    alexaDevServer.hooks['local-dev-server:start']()
    // Expect rejection of request as no server is running on port 5008
    return expect(sendAlexaRequest(5008)).to.be.rejected
  })

  it('should handle failures', () => {
    serverless.service.functions = {
      'MyAlexaSkill': {
        handler: 'lambda-handler.fail',
        events: [ 'alexaSkill' ]
      },
      'MyHttpResource': {
        handler: 'lambda-handler.fail',
        events: [ { http: 'GET /' } ]
      }
    }
    alexaDevServer = new AlexaDevServer(serverless, { port: 5009 })
    alexaDevServer.hooks['local-dev-server:loadEnvVars']()
    alexaDevServer.hooks['local-dev-server:start']()
    return Promise.all([
      sendAlexaRequest(5009).then(result =>
        expect(result.ok).equal(false)
      ),
      sendHttpGetRequest(5009, '').then(result =>
        expect(result.ok).equal(false)
      )
    ])
  })
})
